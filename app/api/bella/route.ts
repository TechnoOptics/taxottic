import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/bella/system-prompt";
import { checkBellaLimit } from "@/lib/plans/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Citation = {
  document_id: string;
  document_title: string;
  source_url: string | null;
  chunk_index: number;
  snippet: string;
};

type Body = {
  conversation_id?: string;
  message: string;
  company_public_id?: string;
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Bella is not configured: ANTHROPIC_API_KEY is missing on the server.",
      },
      { status: 503 },
    );
  }

  // Plan gating: free users get a small monthly question allowance.
  const limit = await checkBellaLimit(supabase, user.id);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error:
          "You have used all of your Bella questions for the month. Upgrade to Pro for unlimited.",
        code: "paywall",
        plan: limit.plan,
        limit: limit.limit,
        used: limit.used,
        upgrade_url: "/billing",
      },
      { status: 402 },
    );
  }

  const body = (await req.json()) as Body;
  const userMessage = (body.message ?? "").trim();
  if (!userMessage) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }

  // 1. Resolve or create conversation.
  let conversationId = body.conversation_id ?? null;
  let companyId: string | null = null;
  let companyContext = null as
    | null
    | {
        id: string;
        publicId: string;
        name: string;
        entityType: string | null;
        primaryIndustry: string | null;
        hasEmployees: boolean;
        hasVehicle: boolean;
        hasHomeOffice: boolean;
        ytdIncomeCents: number;
        ytdExpenseCents: number;
      };

  if (body.company_public_id) {
    const { data: company } = await supabase
      .from("companies")
      .select("id, public_id, name, entity_type")
      .eq("public_id", body.company_public_id)
      .single();
    if (company) {
      companyId = company.id;
      const taxYear = new Date().getUTCFullYear();
      const [{ data: bp }, { data: incomeRows }, { data: expenseRows }] =
        await Promise.all([
          supabase
            .from("business_profiles")
            .select(
              "primary_industry, has_employees, has_vehicle, has_home_office",
            )
            .eq("company_id", company.id)
            .eq("tax_year", taxYear)
            .maybeSingle(),
          supabase
            .from("monthly_income")
            .select("amount_cents")
            .eq("company_id", company.id)
            .eq("tax_year", taxYear),
          supabase
            .from("monthly_expenses")
            .select("amount_cents")
            .eq("company_id", company.id)
            .eq("tax_year", taxYear),
        ]);
      companyContext = {
        id: company.id,
        publicId: company.public_id,
        name: company.name,
        entityType: company.entity_type,
        primaryIndustry: bp?.primary_industry ?? null,
        hasEmployees: bp?.has_employees ?? false,
        hasVehicle: bp?.has_vehicle ?? false,
        hasHomeOffice: bp?.has_home_office ?? false,
        ytdIncomeCents:
          (incomeRows ?? []).reduce((a, r) => a + (r.amount_cents ?? 0), 0),
        ytdExpenseCents:
          (expenseRows ?? []).reduce((a, r) => a + (r.amount_cents ?? 0), 0),
      };
    }
  }

  // Writes use service-role to avoid the SSR auth-cookie quirk in API routes.
  const admin = createServiceClient();

  if (!conversationId) {
    const { data: convo, error } = await admin
      .from("bella_conversations")
      .insert({
        user_id: user.id,
        company_id: companyId,
        title: userMessage.slice(0, 80),
      })
      .select("id")
      .single();
    if (error || !convo) {
      return NextResponse.json(
        { error: "could not start conversation" },
        { status: 500 },
      );
    }
    conversationId = convo.id;
  }

  // 2. Save the user message.
  await admin.from("bella_messages").insert({
    conversation_id: conversationId,
    role: "user",
    content: userMessage,
  });

  // 3. Pull tax profile for context.
  const taxYear = new Date().getUTCFullYear();
  const { data: taxProfile } = await supabase
    .from("tax_profiles")
    .select("filing_status, state_code, age")
    .eq("user_id", user.id)
    .eq("tax_year", taxYear)
    .maybeSingle();

  // 4. RAG: top-K chunks for the user's question.
  const { data: chunks } = await supabase.rpc("bella_kb_search", {
    p_query: userMessage,
    p_limit: 6,
  });

  const citations: Citation[] = (chunks ?? []).map(
    (c: {
      chunk_id: string;
      document_id: string;
      document_title: string;
      source_url: string | null;
      chunk_index: number;
      content: string;
    }) => ({
      document_id: c.document_id,
      document_title: c.document_title,
      source_url: c.source_url,
      chunk_index: c.chunk_index,
      snippet: c.content,
    }),
  );

  // 5. Pull last 10 messages for short-term memory.
  const { data: history } = await supabase
    .from("bella_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20);

  const priorMessages = (history ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-10)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // 6. Compose. Last user turn already includes the new message in priorMessages
  //    (we just inserted it). Prepend the retrieved context to the assistant's
  //    visibility via a system block + a user message that includes the
  //    retrieved snippets (Anthropic doesn't support arbitrary tool-context).
  const retrievalBlock =
    citations.length > 0
      ? "Knowledge base context (cite as [1], [2], ... in order):\n" +
        citations
          .map(
            (c, i) =>
              `[${i + 1}] ${c.document_title} (chunk ${c.chunk_index})${c.source_url ? " - " + c.source_url : ""}\n${c.snippet}`,
          )
          .join("\n\n")
      : "No knowledge base sources matched this question.";

  const systemPrompt = buildSystemPrompt({
    user: {
      email: user.email ?? "",
      filingStatus: taxProfile?.filing_status,
      stateCode: taxProfile?.state_code,
      taxYear,
      age: taxProfile?.age,
    },
    company: companyContext
      ? {
          name: companyContext.name,
          publicId: companyContext.publicId,
          entityType: companyContext.entityType,
          primaryIndustry: companyContext.primaryIndustry,
          hasEmployees: companyContext.hasEmployees,
          hasVehicle: companyContext.hasVehicle,
          hasHomeOffice: companyContext.hasHomeOffice,
          ytdIncomeCents: companyContext.ytdIncomeCents,
          ytdExpenseCents: companyContext.ytdExpenseCents,
        }
      : undefined,
  });

  // The retrieval block goes in front of the latest user turn.
  const messagesForApi = [...priorMessages];
  // Replace the last user message content to inject retrieval context.
  if (messagesForApi.length > 0) {
    const last = messagesForApi[messagesForApi.length - 1];
    messagesForApi[messagesForApi.length - 1] = {
      role: "user",
      content: `${retrievalBlock}\n\n---\n\nQuestion: ${last.content}`,
    };
  }

  // 7. Call Claude.
  const client = new Anthropic({ apiKey });
  let assistantText = "";
  try {
    const result = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messagesForApi.length
        ? messagesForApi
        : [{ role: "user", content: userMessage }],
    });
    assistantText = result.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `Bella could not answer: ${message}` },
      { status: 502 },
    );
  }

  // 8. Save assistant message + citations.
  await admin.from("bella_messages").insert({
    conversation_id: conversationId,
    role: "assistant",
    content: assistantText,
    citations,
  });

  return NextResponse.json({
    conversation_id: conversationId,
    message: assistantText,
    citations,
  });
}
