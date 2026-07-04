/**
 * Receipt OCR.
 *
 * Given an image (or single-page PDF) of a purchase receipt, return the
 * vendor, date, total, and a suggested deduction category code. One
 * Anthropic call per upload, same pattern as extract-tax-doc.
 *
 * Privacy: bytes flow to Anthropic and are not persisted by us. Caller
 * stores only the structured result.
 */

import Anthropic from "@anthropic-ai/sdk";

export type ReceiptExtraction = {
  vendor: string | null;
  /** ISO yyyy-mm-dd or null. */
  date: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  tip_cents: number | null;
  total_cents: number | null;
  payment_method: string | null;
  /** Best-guess deduction-category code from the schema below. May be
   *  null if the model isn't confident. The caller usually shows this
   *  pre-selected and lets the user override. */
  suggested_category: string | null;
  /** Free-text 1-line description suitable for the expense's notes
   *  field, e.g. "Adobe Creative Cloud monthly subscription". */
  description: string | null;
  confidence: number;
  notes: string | null;
};

// Mirror of the public.deduction_categories codes that are most common
// for receipts. We pass these to the model so it suggests one of OUR
// codes rather than inventing its own.
const RECEIPT_CATEGORIES = [
  "office",
  "supplies",
  "software",
  "internet",
  "phone",
  "meals",
  "travel",
  "lodging",
  "vehicle_gas",
  "vehicle_repair",
  "advertising",
  "professional_fees",
  "education",
  "rent",
  "utilities",
  "shipping",
  "subscriptions",
  "tools_equipment",
  "client_entertainment",
  "office_furniture",
] as const;

const SYSTEM = `You read U.S. business purchase receipts (printed, screenshot, or PDF). Return STRICT JSON matching the schema. All money values are integers in CENTS (multiply dollars by 100). Use null for any field you cannot read confidently.

DO NOT GUESS. If a field is partially obscured, blank, or unreadable, return null. Never invent vendor names, totals, or dates.

The "date" field must be the transaction date (when the purchase was made), not the receipt-print date if those differ. Format as ISO yyyy-mm-dd.

The "suggested_category" field MUST be one of these exact strings, or null if none clearly fits:
${RECEIPT_CATEGORIES.map((c) => `  "${c}"`).join("\n")}

Category guidance:
  - office          office/coworking rent or general office costs
  - supplies        consumable office supplies (paper, pens, toner)
  - software        SaaS, app subscriptions, license keys
  - internet        ISP / wifi
  - phone           cell or landline service
  - meals           restaurant, cafe, catering (50% deductible)
  - travel          flights, trains, rideshare/taxi for business trips
  - lodging         hotels, Airbnb on a business trip
  - vehicle_gas     fuel for a business vehicle
  - vehicle_repair  oil change, repair, maintenance
  - advertising     ads, promo, sponsorship
  - professional_fees  legal, accounting, consultant fees
  - education       courses, books, training
  - rent            rented business space (NOT home rent)
  - utilities       electricity, water, gas for business space
  - shipping        postage, FedEx, UPS, courier
  - subscriptions   recurring memberships not covered above
  - tools_equipment hardware tools, equipment > $200 (de minimis only)
  - client_entertainment  client-facing event costs (deductibility varies)
  - office_furniture chair, desk, monitor mount

Return JSON only, no markdown fences, no commentary.

Schema:
{
  "vendor": string | null,
  "date": "yyyy-mm-dd" | null,
  "subtotal_cents": int | null,
  "tax_cents": int | null,
  "tip_cents": int | null,
  "total_cents": int | null,
  "payment_method": string | null,        // e.g. "Visa ****1234", "cash", "Apple Pay"
  "suggested_category": string | null,    // from the list above
  "description": string | null,           // ≤ 80 chars, suitable for notes
  "confidence": number,                   // 0..1
  "notes": string | null                  // anything notable; ≤ 200 chars
}`;

export async function extractReceipt(args: {
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
}): Promise<ReceiptExtraction> {
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

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 800,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          fileBlock,
          {
            type: "text",
            text: "Extract the receipt fields per the schema.",
          },
        ],
      },
    ],
  });

  return parseExtraction(response);
}

export async function extractReceiptFromImagePages(args: {
  pages: Array<{ base64: string }>;
}): Promise<ReceiptExtraction> {
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
    max_tokens: 800,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: "Extract the receipt fields per the schema. If multiple pages are shown, use the page that contains the receipt.",
          },
        ],
      },
    ],
  });

  return parseExtraction(response);
}

function parseExtraction(
  response: Anthropic.Message,
): ReceiptExtraction {
  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content.");
  }
  const stripped = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");

  let parsed: Partial<ReceiptExtraction>;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(
      "Model didn't return valid JSON. Try a higher-resolution scan or enter the receipt manually.",
    );
  }

  const known = new Set<string>(RECEIPT_CATEGORIES);
  return {
    vendor: trimOrNull(parsed.vendor, 200),
    date: validIsoDate(parsed.date),
    subtotal_cents: nonNegIntOrNull(parsed.subtotal_cents),
    tax_cents: nonNegIntOrNull(parsed.tax_cents),
    tip_cents: nonNegIntOrNull(parsed.tip_cents),
    total_cents: nonNegIntOrNull(parsed.total_cents),
    payment_method: trimOrNull(parsed.payment_method, 80),
    suggested_category:
      typeof parsed.suggested_category === "string" &&
      known.has(parsed.suggested_category)
        ? parsed.suggested_category
        : null,
    description: trimOrNull(parsed.description, 200),
    confidence: clamp01(parsed.confidence ?? 0),
    notes: trimOrNull(parsed.notes, 500),
  };
}

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length > 0 ? t : null;
}

function nonNegIntOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

function clamp01(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function validIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return v;
}
