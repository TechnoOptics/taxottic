import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  extractReceipt,
  extractReceiptFromImagePages,
} from "@/lib/ocr/extract-receipt";
import { decryptAndRenderPdf, PdfPasswordError } from "@/lib/pdf/decrypt";
import { consume } from "@/lib/plans/credits";
import { getActivePlan, isSuperAdmin } from "@/lib/plans/usage";
import { CREDIT_COST } from "@/lib/plans/limits";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Multipart upload of a single receipt (image or PDF). Returns the
 * structured extraction so the client can pre-fill the add-expense form
 * for user review. We deliberately don't persist anything here — the
 * user confirms the result and submits via the normal addExpense
 * server action, which gives them a chance to override the category
 * or amount.
 *
 * Optional: password if the receipt is a password-protected PDF
 * (rare for receipts, but lounge wifi printers sometimes seal them).
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

  const password =
    (formData.get("password") as string | null)?.toString() ?? "";

  // Credit gate: receipt OCR costs CREDIT_COST.receipt_ocr credits.
  // Consume up-front so a user with 0 credits doesn't get a free OCR
  // when their balance happens to be racing to zero. If extraction
  // fails after the consume, that's accepted attrition — the balance
  // stays debited so abuse via repeated bad uploads doesn't drain the
  // model on us.
  const admin = createServiceClient();
  const superAdmin = await isSuperAdmin(supabase);
  if (!superAdmin) {
    const plan = await getActivePlan(supabase, user.id);
    if (plan === "free") {
      return NextResponse.json(
        { error: "subscription_required", smallestTier: "filer" },
        { status: 402 },
      );
    }
    const charge = await consume(admin, user.id, "receipt_ocr", null);
    if (!charge.ok) {
      return NextResponse.json(
        {
          error: "insufficient_credits",
          balance: charge.balance,
          needed: CREDIT_COST.receipt_ocr,
        },
        { status: 402 },
      );
    }
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");

  try {
    let result;
    if (password && file.type === "application/pdf") {
      const pages = await decryptAndRenderPdf(new Uint8Array(buf), password);
      result = await extractReceiptFromImagePages({ pages });
    } else {
      result = await extractReceipt({
        base64,
        mimeType: file.type as
          | "image/png"
          | "image/jpeg"
          | "image/webp"
          | "application/pdf",
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PdfPasswordError) {
      return NextResponse.json(
        {
          error: "pdf_password_required",
          reason: err.missing ? "missing" : "incorrect",
        },
        { status: 422 },
      );
    }
    const message = err instanceof Error ? err.message : "Extraction failed";
    if (message.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { error: "Bella isn't configured on the server yet." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
