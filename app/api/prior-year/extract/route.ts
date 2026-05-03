import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractTaxDoc } from "@/lib/ocr/extract-tax-doc";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Multipart upload of a single prior-year tax document. Identifies
 * the doc type AND extracts the structured fields in one Claude call,
 * then persists the result so the user can review + apply later.
 *
 * Optional form fields:
 *   companyId  - link the doc to a specific company (Schedule C,
 *                business 1099s). Personal docs (W-2, 1099-INT) leave
 *                this null.
 *   taxYear    - the year the doc covers. If absent, we use the
 *                model's tax_year extraction; if that's also null,
 *                we default to last year.
 *
 * Returns the extraction PLUS the saved row id so the caller can
 * trigger /api/prior-year/apply later.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_form_data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Upload must be 8 MB or smaller." },
      { status: 413 },
    );
  }
  const allowed = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
  ]);
  if (!allowed.has(file.type)) {
    return NextResponse.json(
      { error: "Use PNG, JPG, WebP, or PDF." },
      { status: 415 },
    );
  }

  const companyIdRaw = formData.get("companyId");
  const companyId =
    typeof companyIdRaw === "string" && companyIdRaw ? companyIdRaw : null;
  const taxYearRaw = formData.get("taxYear");
  const taxYearOverride =
    typeof taxYearRaw === "string" && taxYearRaw
      ? parseInt(taxYearRaw, 10)
      : null;

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");

  let result;
  try {
    result = await extractTaxDoc({
      base64,
      mimeType: file.type as
        | "image/png"
        | "image/jpeg"
        | "image/webp"
        | "application/pdf",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    if (message.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { error: "Bella isn't configured on the server yet." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const taxYear =
    taxYearOverride ??
    result.tax_year ??
    new Date().getUTCFullYear() - 1;

  const { data: row, error } = await supabase
    .from("prior_year_documents")
    .insert({
      user_id: user.id,
      company_id: companyId,
      tax_year: taxYear,
      doc_type: result.doc_type,
      filename: file.name?.slice(0, 200) ?? null,
      extracted_data: {
        ...result.fields,
        payer_or_employer: result.payer_or_employer,
        recipient_name: result.recipient_name,
        state_code: result.state_code,
      },
      confidence: result.confidence,
      notes: result.notes,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    id: row.id,
    ...result,
    tax_year: taxYear,
  });
}
