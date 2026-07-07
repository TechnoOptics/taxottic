import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { extractPaystubs } from "@/lib/ocr/extract-paystub";
import { annualizePaystubs } from "@/lib/tax/paystub-annualize";
import { requireFeatureGate } from "@/lib/plans/gate";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Pay-stub OCR + annualization, the pay-stub sibling of
 * app/api/w2/extract. Accepts multipart/form-data with 1-3 `file`
 * fields (PNG/JPG/WebP/PDF, ideally consecutive stubs so the pay
 * schedule is unambiguous) and returns:
 *
 *   { extraction, annualized }
 *
 * Nothing is persisted here — the client shows the annualized summary
 * and the user explicitly applies it to their tax profile via the
 * applyPaystubAnnualization server action.
 *
 * Same auth + plan gate as the W-2 route (this feeds the personal
 * forecast, a Filer-and-above feature) and the same "never store the
 * image" privacy posture. Locked PDFs get a clean 422 (the W-2 flow's
 * password-decrypt path can be ported here if users ask for it).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  if (
    !checkRateLimit(`paystub-ocr:${user.id}`, {
      capacity: 12,
      refillPerMinute: 12,
    })
  ) {
    return NextResponse.json(
      { error: "Too many requests, please slow down." },
      { status: 429 },
    );
  }

  const gateFail = await requireFeatureGate(
    supabase,
    user.id,
    "personalForecast",
  );
  if (gateFail) return gateFail;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_form_data" }, { status: 400 });
  }

  const files = formData
    .getAll("file")
    .filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (files.length > 3) {
    return NextResponse.json(
      { error: "Upload at most three stubs." },
      { status: 400 },
    );
  }

  const allowed = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/pdf",
  ]);
  const inputs: Array<{
    base64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  }> = [];
  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Each upload must be 8 MB or smaller." },
        { status: 413 },
      );
    }
    if (!allowed.has(file.type)) {
      return NextResponse.json(
        { error: "Use PNG, JPG, WebP, or PDF." },
        { status: 415 },
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    inputs.push({
      base64: buf.toString("base64"),
      mimeType: file.type as (typeof inputs)[number]["mimeType"],
    });
  }

  try {
    const extraction = await extractPaystubs(inputs);
    if (extraction.stubs.length === 0) {
      return NextResponse.json(
        {
          error:
            "Couldn't find a pay stub in the upload. Try a clearer photo or a PDF from your payroll portal.",
        },
        { status: 422 },
      );
    }
    const annualized = annualizePaystubs(extraction.stubs);
    return NextResponse.json({ extraction, annualized });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.toLowerCase().includes("password")) {
      return NextResponse.json(
        {
          error:
            "This PDF is password protected. Unlock it (print-to-PDF works) and re-upload.",
        },
        { status: 422 },
      );
    }
    if (message.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        {
          error:
            "Bella isn't configured on the server yet. Enter your income manually for now.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
