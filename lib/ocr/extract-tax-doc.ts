/**
 * Universal prior-year tax document extractor. Given an image or PDF
 * the model first identifies what kind of doc it is (W-2, 1099-NEC,
 * etc.), then returns the structured fields appropriate to that type.
 *
 * Single Anthropic call per upload to keep latency + cost low. The
 * model's job is essentially "look at this form, tell me what it is
 * AND pull the numbers". We prompt-engineer the schema so every
 * doc_type returns a consistent JSON shape - just different keys are
 * populated.
 *
 * Privacy: same as W-2 extractor - bytes flow to Anthropic and are
 * not persisted. Caller stores only the structured result.
 */

import Anthropic from "@anthropic-ai/sdk";
import { PdfPasswordRequiredError } from "./extract-w2";

function isPasswordProtectedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes("password protected") || m.includes("password-protected");
}

export type PriorDocType =
  | "w2"
  | "1099_nec"
  | "1099_misc"
  | "1099_k"
  | "1099_div"
  | "1099_int"
  | "1099_r"
  | "1099_g"
  | "k1"
  | "schedule_c"
  | "form_1040"
  | "unknown";

export type PriorDocExtraction = {
  doc_type: PriorDocType;
  tax_year: number | null;
  // Counterparty: payer (1099s), employer (W-2), entity (K-1), etc.
  payer_or_employer: string | null;
  recipient_name: string | null;
  // The structured numbers. Cents always. Per-doc-type keys.
  //   W-2:        wages, federal_withheld, ss_wages, state_wages, state_code
  //   1099-NEC:   nonemployee_comp, federal_withheld
  //   1099-MISC:  rents, royalties, other, federal_withheld
  //   1099-K:     gross_payments, federal_withheld
  //   1099-DIV:   ordinary_div, qualified_div, capital_gain
  //   1099-INT:   interest_income, federal_withheld
  //   1099-R:     gross_distribution, taxable_amount, federal_withheld
  //   1099-G:     unemployment, state_refund
  //   K-1:        ordinary_business_income, self_employment_earnings
  //   Schedule C: gross_receipts, total_expenses, net_profit
  //   Form 1040:  total_income, agi, taxable_income, total_tax, refund
  fields: Record<string, number | string | null>;
  state_code: string | null;
  confidence: number;
  notes: string | null;
};

const SYSTEM = `You read U.S. tax documents (W-2, 1099-NEC, 1099-MISC, 1099-K, 1099-DIV, 1099-INT, 1099-R, 1099-G, Schedule K-1, Schedule C, Form 1040). Return STRICT JSON matching the schema. All money values are integers in CENTS (multiply dollars by 100). Use null for any field you cannot read confidently.

DO NOT GUESS. If a field is partially obscured, blank, or unreadable, return null. Do not invent numbers, names, employer details, or state codes.

Step 1: identify the doc_type. Look at the form heading. Possible values:
  "w2"          - Form W-2 Wage and Tax Statement
  "1099_nec"    - 1099-NEC Nonemployee Compensation
  "1099_misc"   - 1099-MISC Miscellaneous Information
  "1099_k"      - 1099-K Payment Card and Third Party Network Transactions
  "1099_div"    - 1099-DIV Dividends and Distributions
  "1099_int"    - 1099-INT Interest Income
  "1099_r"      - 1099-R Distributions From Pensions, Retirement Plans
  "1099_g"      - 1099-G Certain Government Payments
  "k1"          - Schedule K-1 (Partnership / S-Corp share of income)
  "schedule_c"  - Schedule C Profit or Loss From Business
  "form_1040"   - Form 1040 (the main return)
  "unknown"     - none of the above, or you're not confident

Step 2: extract the fields appropriate to that doc_type. The "fields" object's keys depend on doc_type:

W-2:
  "wages_cents" (Box 1)
  "federal_withheld_cents" (Box 2)
  "social_security_wages_cents" (Box 3)
  "medicare_wages_cents" (Box 5)
  "state_wages_cents" (Box 16)
  "state_income_tax_cents" (Box 17)

1099-NEC:
  "nonemployee_comp_cents" (Box 1)
  "federal_withheld_cents" (Box 4)

1099-MISC:
  "rents_cents" (Box 1)
  "royalties_cents" (Box 2)
  "other_income_cents" (Box 3)
  "federal_withheld_cents" (Box 4)

1099-K:
  "gross_payments_cents" (Box 1a)
  "federal_withheld_cents" (Box 4)

1099-DIV:
  "ordinary_dividends_cents" (Box 1a)
  "qualified_dividends_cents" (Box 1b)
  "capital_gain_distributions_cents" (Box 2a)
  "federal_withheld_cents" (Box 4)

1099-INT:
  "interest_income_cents" (Box 1)
  "federal_withheld_cents" (Box 4)

1099-R:
  "gross_distribution_cents" (Box 1)
  "taxable_amount_cents" (Box 2a)
  "federal_withheld_cents" (Box 4)

1099-G:
  "unemployment_comp_cents" (Box 1)
  "state_local_refund_cents" (Box 2)

K-1:
  "ordinary_business_income_cents"
  "self_employment_earnings_cents"

Schedule C:
  "gross_receipts_cents" (Line 1)
  "returns_allowances_cents" (Line 2)
  "cost_of_goods_sold_cents" (Line 4)
  "gross_profit_cents" (Line 7)
  "total_expenses_cents" (Line 28)
  "net_profit_cents" (Line 31)

Form 1040:
  "total_income_cents" (Line 9)
  "agi_cents" (Line 11)
  "taxable_income_cents" (Line 15)
  "total_tax_cents" (Line 24)
  "total_payments_cents" (Line 33)
  "refund_cents" (Line 34)
  "amount_owed_cents" (Line 37)

Always also fill: tax_year, payer_or_employer (the issuer/employer name), recipient_name, state_code (if shown), confidence (0..1), notes (any caveats).

Return only the JSON object. No prose before or after.`;

const SCHEMA = `{
  "doc_type": "w2"|"1099_nec"|"1099_misc"|"1099_k"|"1099_div"|"1099_int"|"1099_r"|"1099_g"|"k1"|"schedule_c"|"form_1040"|"unknown",
  "tax_year": number|null,
  "payer_or_employer": string|null,
  "recipient_name": string|null,
  "fields": { /* per-type keys, see above */ },
  "state_code": string|null,
  "confidence": number,
  "notes": string|null
}`;

export async function extractTaxDoc(args: {
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
}): Promise<PriorDocExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }
  const client = new Anthropic({ apiKey });

  const isPdf = args.mimeType === "application/pdf";
  const fileBlock = isPdf
    ? {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data: args.base64,
        },
      }
    : {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: args.mimeType as "image/png" | "image/jpeg" | "image/webp",
          data: args.base64,
        },
      };

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            {
              type: "text",
              text: `Identify the doc type and extract the fields. Schema:\n${SCHEMA}`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    if (isPasswordProtectedError(err)) throw new PdfPasswordRequiredError();
    throw err;
  }

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content.");
  }
  const stripped = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");

  let parsed: Partial<PriorDocExtraction>;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(
      "Model didn't return valid JSON. Try a higher-resolution scan or enter manually.",
    );
  }

  const docType: PriorDocType = isPriorDocType(parsed.doc_type)
    ? parsed.doc_type
    : "unknown";

  return {
    doc_type: docType,
    tax_year: numOrNull(parsed.tax_year),
    payer_or_employer: trimOrNull(parsed.payer_or_employer, 200),
    recipient_name: trimOrNull(parsed.recipient_name, 200),
    fields:
      parsed.fields && typeof parsed.fields === "object"
        ? sanitizeFields(parsed.fields as Record<string, unknown>)
        : {},
    state_code:
      typeof parsed.state_code === "string"
        ? parsed.state_code.toUpperCase().slice(0, 2) || null
        : null,
    confidence: clamp01(parsed.confidence ?? 0),
    notes: trimOrNull(parsed.notes, 500),
  };
}

/**
 * Variant that takes already-rendered page images (PNGs from the PDF
 * decryption step). Used after the user unlocks a password-protected
 * PDF via the popup; we render the pages server-side and ship them
 * to Claude as image content blocks instead of as a sealed PDF.
 */
export async function extractTaxDocFromImagePages(args: {
  pages: Array<{ base64: string }>;
}): Promise<PriorDocExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }
  const client = new Anthropic({ apiKey });

  const imageBlocks = args.pages.map((p) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/png" as const,
      data: p.base64,
    },
  }));

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Identify the doc type and extract the fields from the page(s) above. If multiple pages are provided, find the page with the actual tax form and extract from there. Schema:\n${SCHEMA}`,
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

  let parsed: Partial<PriorDocExtraction>;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(
      "Model didn't return valid JSON. Try a higher-resolution scan or enter manually.",
    );
  }

  const docType: PriorDocType = isPriorDocType(parsed.doc_type) ? parsed.doc_type : "unknown";

  return {
    doc_type: docType,
    tax_year: numOrNull(parsed.tax_year),
    payer_or_employer: trimOrNull(parsed.payer_or_employer, 200),
    recipient_name: trimOrNull(parsed.recipient_name, 200),
    fields:
      parsed.fields && typeof parsed.fields === "object"
        ? sanitizeFields(parsed.fields as Record<string, unknown>)
        : {},
    state_code:
      typeof parsed.state_code === "string"
        ? parsed.state_code.toUpperCase().slice(0, 2) || null
        : null,
    confidence: clamp01(parsed.confidence ?? 0),
    notes: trimOrNull(parsed.notes, 500),
  };
}

const VALID_TYPES = new Set<PriorDocType>([
  "w2",
  "1099_nec",
  "1099_misc",
  "1099_k",
  "1099_div",
  "1099_int",
  "1099_r",
  "1099_g",
  "k1",
  "schedule_c",
  "form_1040",
  "unknown",
]);

function isPriorDocType(v: unknown): v is PriorDocType {
  return typeof v === "string" && VALID_TYPES.has(v as PriorDocType);
}

function numOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.round(v);
}

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function clamp01(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function sanitizeFields(
  raw: Record<string, unknown>,
): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) {
      out[k] = null;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Math.round(v);
    } else if (typeof v === "string") {
      out[k] = v.slice(0, 200);
    }
    // skip arrays, nested objects
  }
  return out;
}

/**
 * Human-friendly labels for the prior_doc_type enum. Used in UI.
 */
export const DOC_TYPE_LABELS: Record<PriorDocType, string> = {
  w2: "Form W-2 (wages)",
  "1099_nec": "1099-NEC (nonemployee comp)",
  "1099_misc": "1099-MISC",
  "1099_k": "1099-K (payment card)",
  "1099_div": "1099-DIV (dividends)",
  "1099_int": "1099-INT (interest)",
  "1099_r": "1099-R (retirement)",
  "1099_g": "1099-G (gov payments)",
  k1: "Schedule K-1 (partnership/S-corp)",
  schedule_c: "Schedule C (business P&L)",
  form_1040: "Form 1040 (full return)",
  unknown: "Other / unrecognized",
};
