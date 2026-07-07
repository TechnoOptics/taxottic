/**
 * Pay-stub OCR via Anthropic's vision-capable Claude — the pay-stub
 * sibling of lib/ocr/extract-w2.ts. The user uploads one to three
 * CONSECUTIVE stubs; we send them all in a single vision call so the
 * model can cross-check pay dates and YTD progression, and return a
 * per-stub structured read.
 *
 * Privacy: identical policy to the W-2 path — the bytes flow through
 * this function to Anthropic and are never written to storage. The
 * caller annualizes the result (lib/tax/paystub-annualize.ts) and the
 * user reviews before anything touches their tax profile.
 */

import Anthropic from "@anthropic-ai/sdk";

export type PaystubRead = {
  /** ISO date the check was paid, e.g. "2026-06-15". */
  pay_date: string | null;
  /** Pay-period bounds when printed. */
  period_start: string | null;
  period_end: string | null;
  /** Gross pay THIS period (before any deductions). */
  gross_cents: number | null;
  /** Federal income tax withheld this period. */
  federal_withheld_cents: number | null;
  /** State income tax withheld this period. */
  state_withheld_cents: number | null;
  /** Pre-tax retirement this period (401k / 403b / 457 employee deferral). */
  pretax_retirement_cents: number | null;
  /** Pre-tax health/dental/vision premiums this period (cafeteria plan). */
  pretax_health_cents: number | null;
  /** HSA contribution through payroll this period. */
  hsa_cents: number | null;
  /** Year-to-date gross, when printed. */
  ytd_gross_cents: number | null;
  /** Year-to-date federal withholding, when printed. */
  ytd_federal_withheld_cents: number | null;
};

export type PaystubExtraction = {
  stubs: PaystubRead[];
  employer_name: string | null;
  /** Two-letter state code from the state-tax line, when shown. */
  state_code: string | null;
  /** Model's own read-reliability estimate, 0..1. */
  confidence: number;
  notes: string | null;
};

const SYSTEM = `You read employee pay stubs (paycheck statements). Return STRICT JSON only — no prose, no code fences. All money values are integers in cents (dollars × 100). All dates are ISO "YYYY-MM-DD". Use null for anything you cannot read confidently.

Do NOT guess. If a value is absent or unreadable, return null and explain briefly in "notes".

Per stub, read the CURRENT-PERIOD column (not YTD) for: gross pay, federal income tax withheld, state income tax withheld, pre-tax retirement (401k/403b/457 employee deferral), pre-tax health+dental+vision premiums combined, HSA contribution. Read the YTD column only for ytd_gross_cents and ytd_federal_withheld_cents. "Gross" means before every deduction. Social Security / Medicare taxes are NOT federal income tax withholding — do not mix them in.

If multiple stubs are provided, return one entry per stub in chronological order (earliest pay date first).`;

const SCHEMA = `{
  "stubs": [{
    "pay_date": "YYYY-MM-DD"|null,
    "period_start": "YYYY-MM-DD"|null,
    "period_end": "YYYY-MM-DD"|null,
    "gross_cents": number|null,
    "federal_withheld_cents": number|null,
    "state_withheld_cents": number|null,
    "pretax_retirement_cents": number|null,
    "pretax_health_cents": number|null,
    "hsa_cents": number|null,
    "ytd_gross_cents": number|null,
    "ytd_federal_withheld_cents": number|null
  }],
  "employer_name": string|null,
  "state_code": string|null,
  "confidence": number,
  "notes": string|null
}`;

type FileInput = {
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
};

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}
function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function clamp01(v: unknown): number {
  const n = typeof v === "number" ? v : 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * One vision call over 1-3 stub files (images and/or PDFs — a single
 * multi-page PDF of several stubs also works; the model splits pages
 * into stub entries itself).
 */
export async function extractPaystubs(
  files: FileInput[],
): Promise<PaystubExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }
  const client = new Anthropic({ apiKey });

  const blocks = files.map((f) =>
    f.mimeType === "application/pdf"
      ? {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: f.base64,
          },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: f.mimeType,
            data: f.base64,
          },
        },
  );

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...blocks,
          {
            type: "text",
            text: `Extract every pay stub shown. Schema:\n${SCHEMA}`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content.");
  }
  const stripped = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");

  let parsed: Partial<PaystubExtraction> & { stubs?: unknown };
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(
      "Couldn't read the stub. Try a clearer photo or a PDF export from your payroll portal.",
    );
  }

  const rawStubs = Array.isArray(parsed.stubs) ? parsed.stubs : [];
  const stubs: PaystubRead[] = rawStubs.slice(0, 6).map((s) => {
    const r = (s ?? {}) as Record<string, unknown>;
    return {
      pay_date: isoOrNull(r.pay_date),
      period_start: isoOrNull(r.period_start),
      period_end: isoOrNull(r.period_end),
      gross_cents: numOrNull(r.gross_cents),
      federal_withheld_cents: numOrNull(r.federal_withheld_cents),
      state_withheld_cents: numOrNull(r.state_withheld_cents),
      pretax_retirement_cents: numOrNull(r.pretax_retirement_cents),
      pretax_health_cents: numOrNull(r.pretax_health_cents),
      hsa_cents: numOrNull(r.hsa_cents),
      ytd_gross_cents: numOrNull(r.ytd_gross_cents),
      ytd_federal_withheld_cents: numOrNull(r.ytd_federal_withheld_cents),
    };
  });

  return {
    stubs,
    employer_name:
      typeof parsed.employer_name === "string" && parsed.employer_name.trim()
        ? parsed.employer_name.trim().slice(0, 200)
        : null,
    state_code:
      typeof parsed.state_code === "string"
        ? parsed.state_code.toUpperCase().slice(0, 2) || null
        : null,
    confidence: clamp01(parsed.confidence),
    notes:
      typeof parsed.notes === "string" && parsed.notes.trim()
        ? parsed.notes.trim().slice(0, 500)
        : null,
  };
}
