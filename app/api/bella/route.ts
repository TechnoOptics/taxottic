import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/bella/system-prompt";
import { getActivePlan, isSuperAdmin } from "@/lib/plans/usage";
import { consume } from "@/lib/plans/credits";
import {
  BELLA_MODEL_BY_PLAN,
  bellaCreditCost,
  type BellaModel,
} from "@/lib/plans/limits";

/** Anthropic model IDs per Bella tier. */
const MODEL_ID: Record<BellaModel, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-5",
  opus: "claude-opus-4-7",
};

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

  // Per-user rate limit on this LLM endpoint — credits cap spend, but this
  // stops rapid-fire abuse / runaway clients from hammering the model.
  if (!checkRateLimit(`bella:${user.id}`, { capacity: 15, refillPerMinute: 15 })) {
    return NextResponse.json(
      { error: "Too many requests — please slow down." },
      { status: 429 },
    );
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

  // Tier-gated model selection. Each plan maps to one Bella model
  // (Filer→Haiku, Solo/Studio→Sonnet, Scale/Practice→Opus). Credits
  // pay for *more questions at the model your tier unlocks* — they
  // can't buy access to a higher model.
  const plan = await getActivePlan(supabase, user.id);
  const model = BELLA_MODEL_BY_PLAN[plan];
  if (!model) {
    return NextResponse.json(
      {
        error:
          "Bella is included with every paid plan. Upgrade to Filer to ask your first question.",
        code: "subscription_required",
        plan,
        upgrade_url: "/billing",
      },
      { status: 402 },
    );
  }
  const admin = createServiceClient();
  const cost = bellaCreditCost(model);
  // Super admins (forever-allowlist) skip credit consumption — they
  // have unlimited usage by policy. We still record the action via
  // bella_messages for audit, just not as a paid debit.
  const superAdmin = await isSuperAdmin(supabase);
  const charge = superAdmin
    ? ({ ok: true, balanceAfter: Number.POSITIVE_INFINITY, cost: 0 } as const)
    : await consume(admin, user.id, `bella_${model}` as const, null);
  if (!charge.ok) {
    return NextResponse.json(
      {
        error: `You're ${cost - charge.balance} credits short for this question. Top up or upgrade for more.`,
        code: "insufficient_credits",
        balance: charge.balance,
        needed: cost,
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
    // SECURITY: company_public_id comes from the request body. Only attach
    // this company's context if the caller is actually a member — otherwise a
    // user could pass any public_id and bind a Bella conversation (written
    // below with the service-role client, which bypasses RLS) to, and surface
    // the name/profile of, a company they don't belong to.
    const { data: membership } = company
      ? await supabase
          .from("company_members")
          .select("user_id")
          .eq("company_id", company.id)
          .eq("user_id", user.id)
          .maybeSingle()
      : { data: null };
    if (company && membership) {
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

  // Writes use service-role to avoid the SSR auth-cookie quirk in API
  // routes. (admin was already initialized above for credit consumption.)
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
      model: MODEL_ID[model],
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
    // Log detail server-side; return a generic message to the client.
    console.error("[bella] answer failed:", message);
    return NextResponse.json(
      { error: "Bella couldn't answer right now. Please try again." },
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
