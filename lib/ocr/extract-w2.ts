/**
 * W-2 OCR via Anthropic's vision-capable Claude. Given an image or
 * PDF of a W-2, returns the structured fields we need to populate
 * the tax profile (wages, withholding, social-security wages).
 *
 * We deliberately do NOT use a dedicated OCR-as-a-service like
 * Textract for v1 - the Anthropic SDK is already wired for Bella, the
 * vision quality is excellent on standard W-2 layouts, and we can
 * iterate prompts without provisioning new infrastructure.
 *
 * Privacy: we don't persist the image. The bytes flow through this
 * function and into Anthropic, the structured result comes back, and
 * the caller applies it to the tax profile. The image is never
 * written to Supabase storage.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * Thrown when Anthropic refuses a PDF for being password-locked.
 * The route handler maps this to an HTTP 422 with a structured body so
 * the UI can pop a password prompt and retry with the unlocked images.
 */
export class PdfPasswordRequiredError extends Error {
  constructor() {
    super("This PDF is password protected.");
    this.name = "PdfPasswordRequiredError";
  }
}

function isPasswordProtectedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes("password protected") || m.includes("password-protected");
}

export type W2Extraction = {
  // Box 1
  wages_cents: number | null;
  // Box 2
  federal_income_tax_withheld_cents: number | null;
  // Box 3 (used to share the SS wage base with SE earnings)
  social_security_wages_cents: number | null;
  // Box 4 (currently informational, not yet used)
  social_security_tax_withheld_cents: number | null;
  // Box 5
  medicare_wages_cents: number | null;
  // Box 6
  medicare_tax_withheld_cents: number | null;
  // Box 16 (state wages)
  state_wages_cents: number | null;
  // Box 17 (state income tax)
  state_income_tax_cents: number | null;
  // Box 15
  state_code: string | null;
  // Optional metadata
  employer_name: string | null;
  tax_year: number | null;
  // Confidence: 0..1, our own estimate of how reliable the read was
  confidence: number;
  // Free-form notes from the model when fields are unreadable
  notes: string | null;
};

const SYSTEM = `You read W-2 wage statements. Return the requested fields as STRICT JSON. All money values are integers in cents (multiply dollars by 100, no decimals). Use null for any field you cannot read confidently.

Important: do NOT guess. If a field is partially obscured, blank, or you can't read it confidently, return null and add a short note in "notes" instead. Do NOT invent state codes, employer names, or numbers.

Field mapping:
- Box 1 -> wages_cents
- Box 2 -> federal_income_tax_withheld_cents
- Box 3 -> social_security_wages_cents
- Box 4 -> social_security_tax_withheld_cents
- Box 5 -> medicare_wages_cents
- Box 6 -> medicare_tax_withheld_cents
- Box 16 -> state_wages_cents
- Box 17 -> state_income_tax_cents
- Box 15 -> state_code (two-letter state code, uppercase)
- Employer name (top section) -> employer_name
- Tax year -> tax_year (4-digit year)

Return only the JSON object. No prose before or after.`;

const SCHEMA = `{
  "wages_cents": number|null,
  "federal_income_tax_withheld_cents": number|null,
  "social_security_wages_cents": number|null,
  "social_security_tax_withheld_cents": number|null,
  "medicare_wages_cents": number|null,
  "medicare_tax_withheld_cents": number|null,
  "state_wages_cents": number|null,
  "state_income_tax_cents": number|null,
  "state_code": string|null,
  "employer_name": string|null,
  "tax_year": number|null,
  "confidence": number,
  "notes": string|null
}`;

/**
 * Run the vision call. Caller passes the file as a data URL string
 * (e.g., "data:image/png;base64,...") OR a base64 string + mime type.
 */
export async function extractW2FromImage(args: {
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
}): Promise<W2Extraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured on the server.",
    );
  }
  const client = new Anthropic({ apiKey });

  // We use claude-sonnet-4-5 for vision; it handles W-2 layouts well
  // and is cheap enough for a per-upload usage. For PDFs we send as
  // a "document" content block which the SDK supports natively.
  const isPdf = args.mimeType === "application/pdf";

  // The SDK types image media_type as a closed enum that doesn't
  // include application/pdf - PDFs go through the "document" block
  // type instead. We branch and assemble the content block in two
  // separate paths so TypeScript can narrow correctly.
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
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            fileBlock,
            {
              type: "text",
              text: `Extract the W-2 fields. Schema:\n${SCHEMA}`,
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
  const raw = textBlock.text.trim();
  // Strip code-fence wrapping if the model added one despite the prompt.
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");

  let parsed: Partial<W2Extraction>;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(
      "Model didn't return valid JSON. Try uploading a higher-resolution image or use the manual entry form instead.",
    );
  }

  // Coerce + clamp every field. We trust the model's confidence but
  // cap to [0, 1] as a sanity rail.
  return {
    wages_cents: numOrNull(parsed.wages_cents),
    federal_income_tax_withheld_cents: numOrNull(
      parsed.federal_income_tax_withheld_cents,
    ),
    social_security_wages_cents: numOrNull(parsed.social_security_wages_cents),
    social_security_tax_withheld_cents: numOrNull(
      parsed.social_security_tax_withheld_cents,
    ),
    medicare_wages_cents: numOrNull(parsed.medicare_wages_cents),
    medicare_tax_withheld_cents: numOrNull(parsed.medicare_tax_withheld_cents),
    state_wages_cents: numOrNull(parsed.state_wages_cents),
    state_income_tax_cents: numOrNull(parsed.state_income_tax_cents),
    state_code:
      typeof parsed.state_code === "string"
        ? parsed.state_code.toUpperCase().slice(0, 2) || null
        : null,
    employer_name:
      typeof parsed.employer_name === "string" && parsed.employer_name.trim()
        ? parsed.employer_name.trim().slice(0, 200)
        : null,
    tax_year: numOrNull(parsed.tax_year),
    confidence: clamp01(parsed.confidence ?? 0),
    notes:
      typeof parsed.notes === "string" && parsed.notes.trim()
        ? parsed.notes.trim().slice(0, 500)
        : null,
  };
}

/**
 * Variant that takes already-rendered page images (PNGs from the PDF
 * decryption step) instead of a single PDF blob. Used when the user
 * unlocks a password-protected PDF via the popup; we render the pages
 * server-side and then send them to Claude as image content blocks.
 */
export async function extractW2FromImagePages(args: {
  pages: Array<{ base64: string }>;
}): Promise<W2Extraction> {
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
    max_tokens: 1024,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `Extract the W-2 fields from the page(s) above. If multiple pages are provided, prefer the page that has the actual W-2 form. Schema:\n${SCHEMA}`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((c) => c.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content.");
  }
  const raw = textBlock.text.trim();
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");

  let parsed: Partial<W2Extraction>;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(
      "Model didn't return valid JSON. Try uploading a higher-resolution image or use the manual entry form instead.",
    );
  }

  return {
    wages_cents: numOrNull(parsed.wages_cents),
    federal_income_tax_withheld_cents: numOrNull(parsed.federal_income_tax_withheld_cents),
    social_security_wages_cents: numOrNull(parsed.social_security_wages_cents),
    social_security_tax_withheld_cents: numOrNull(parsed.social_security_tax_withheld_cents),
    medicare_wages_cents: numOrNull(parsed.medicare_wages_cents),
    medicare_tax_withheld_cents: numOrNull(parsed.medicare_tax_withheld_cents),
    state_wages_cents: numOrNull(parsed.state_wages_cents),
    state_income_tax_cents: numOrNull(parsed.state_income_tax_cents),
    state_code:
      typeof parsed.state_code === "string"
        ? parsed.state_code.toUpperCase().slice(0, 2) || null
        : null,
    employer_name:
      typeof parsed.employer_name === "string" && parsed.employer_name.trim()
        ? parsed.employer_name.trim().slice(0, 200)
        : null,
    tax_year: numOrNull(parsed.tax_year),
    confidence: clamp01(parsed.confidence ?? 0),
    notes:
      typeof parsed.notes === "string" && parsed.notes.trim()
        ? parsed.notes.trim().slice(0, 500)
        : null,
  };
}

function numOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  // Round in case the model snuck in a decimal anyway.
  return Math.round(v);
}

function clamp01(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
