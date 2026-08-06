/**
 * Bella batch categorizer for imported bank transactions.
 *
 * Given a list of transactions plus the company's allowed expense
 * category codes and income source codes, ask Sonnet 4.5 to classify
 * each row in one shot. The model returns a per-row decision with a
 * confidence score; the caller decides what to auto-apply vs. queue
 * for review.
 *
 * Privacy: descriptions and amounts are sent to Anthropic; we don't
 * persist anything on their side. Caller stores only the structured
 * result.
 */

import Anthropic from "@anthropic-ai/sdk";

export type CategorizeInput = {
  /** id is opaque, caller maps results back via this. */
  id: string;
  description: string;
  amount_cents: number;
  posted_at: string | null;
  raw_category: string | null;
};

export type CategorizeKind = "expense" | "income" | "transfer" | "unsure";

export type CategorizeDecision = {
  id: string;
  kind: CategorizeKind;
  /**
   * For expense: a code from allowedExpenseCodes.
   * For income: a code from allowedIncomeSources.
   * For transfer / unsure: null.
   */
  code: string | null;
  /** 0..1, caller auto-applies above 0.75. */
  confidence: number;
  /** Short human-readable rationale; surfaced in audit/UI on hover. */
  reason: string;
};

const SYSTEM = `You categorize U.S. business bank-transaction CSV rows. Output STRICT JSON, an array of objects, one per row, in the SAME ORDER as the input. No prose, no markdown fences.

Each output row:
{
  "id": <copy from input>,
  "kind": "expense" | "income" | "transfer" | "unsure",
  "code": <one of the allowed codes for that kind, or null>,
  "confidence": <0..1>,
  "reason": <≤ 80 chars, why you chose this>
}

Rules:
- "expense": a deductible business cost. "code" must be one of allowedExpenseCodes.
- "income": revenue, deposit, or interest. "code" must be one of allowedIncomeSources.
- "transfer": movement between user's own accounts (e.g. credit-card payment, ATM withdrawal, transfer to savings). "code" = null.
- "unsure": you can't confidently classify. "code" = null. Use sparingly.
- confidence ≥ 0.85 means "auto-apply this." Below 0.7 means "leave for human review."
- The amount sign IS NOT a reliable indicator across CSV formats, read the description.
- "transfer" examples: "AUTOPAY", "Payment Received - Thank You", "Transfer to Checking", "ATM WITHDRAWAL", "ZELLE TRANSFER FROM <self>".
- Be conservative with "income": only mark as income when the description clearly indicates revenue (a customer name, "INVOICE", "PAYMENT", a payment-processor like Stripe/Square/PayPal payouts). Bank interest goes to "interest" income source.
- Spend / fee / fuel / SaaS / restaurant / supplies / etc. → "expense".
- Always emit one entry per input row, in the same order.`;

const ANTHROPIC_MODEL = "claude-sonnet-4-5";

export async function categorizeBatch(args: {
  transactions: CategorizeInput[];
  allowedExpenseCodes: string[];
  allowedIncomeSources: string[];
  /** "credit" → never emit "income" (deposits on a card are payments). */
  accountType: string;
}): Promise<CategorizeDecision[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }
  if (args.transactions.length === 0) return [];

  const client = new Anthropic({ apiKey });

  // Trim per-row payload to keep tokens bounded.
  const rows = args.transactions.map((t) => ({
    id: t.id,
    description: (t.description ?? "").slice(0, 200),
    amount_cents: t.amount_cents,
    posted_at: t.posted_at,
    raw_category: t.raw_category ? t.raw_category.slice(0, 80) : null,
  }));

  const userMessage = [
    `accountType: ${args.accountType}`,
    `allowedExpenseCodes: ${JSON.stringify(args.allowedExpenseCodes)}`,
    `allowedIncomeSources: ${JSON.stringify(args.allowedIncomeSources)}`,
    `rows:`,
    JSON.stringify(rows),
  ].join("\n");

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    // One output object per input row costs roughly 55-70 tokens: the
    // 36-char UUID alone is ~15, plus the JSON scaffolding and an
    // <= 80-char reason. The old pairing of max_tokens 4000 with the
    // caller's 150-row chunk could not hold a full answer by simple
    // arithmetic (150 x ~60 = ~9000), and a response cut off at the
    // cap is invalid JSON, which surfaced as the misleading "Bella
    // didn't return valid JSON" below. The caller now chunks to 60
    // rows; 8000 leaves better than 2x headroom over that and stays
    // well under the size where a non-streaming request risks an SDK
    // HTTP timeout.
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage }],
  });

  // Truncation is not a parse problem, and reporting it as one sent
  // everyone looking in the wrong place. Name it explicitly.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `Bella ran out of room answering ${args.transactions.length} rows at once. The import is unchanged; try again.`,
    );
  }

  const text = response.content.find((c) => c.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Bella returned no text content.");
  }
  const stripped = text.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(
      "Bella didn't return valid JSON. The import is unchanged; try again.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Bella returned an unexpected shape.");
  }

  const allowedExp = new Set(args.allowedExpenseCodes);
  const allowedInc = new Set(args.allowedIncomeSources);
  const validKinds = new Set<CategorizeKind>([
    "expense",
    "income",
    "transfer",
    "unsure",
  ]);

  const out: CategorizeDecision[] = [];
  for (const row of parsed as Array<Record<string, unknown>>) {
    const id = typeof row.id === "string" ? row.id : "";
    const kind: CategorizeKind = validKinds.has(row.kind as CategorizeKind)
      ? (row.kind as CategorizeKind)
      : "unsure";
    let code: string | null =
      typeof row.code === "string" && row.code.length > 0 ? row.code : null;
    // Sanity-check the code against the allowed lists; null it out if
    // the model invented something. This protects against typo'd
    // foreign keys in monthly_expenses/monthly_income.
    if (kind === "expense" && (!code || !allowedExp.has(code))) code = null;
    else if (kind === "income" && (!code || !allowedInc.has(code))) code = null;
    else if (kind === "transfer" || kind === "unsure") code = null;

    const conf =
      typeof row.confidence === "number" && Number.isFinite(row.confidence)
        ? Math.max(0, Math.min(1, row.confidence))
        : 0;
    const reason =
      typeof row.reason === "string" ? row.reason.slice(0, 200) : "";

    if (id) {
      out.push({ id, kind, code, confidence: conf, reason });
    }
  }
  return out;
}
