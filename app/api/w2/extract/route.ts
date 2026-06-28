import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  extractW2FromImage,
  extractW2FromImagePages,
  PdfPasswordRequiredError,
} from "@/lib/ocr/extract-w2";
import { decryptAndRenderPdf, PdfPasswordError } from "@/lib/pdf/decrypt";
import { requireFeatureGate } from "@/lib/plans/gate";

export const runtime = "nodejs";
// 50 MB upload cap.
export const maxDuration = 60;

/**
 * Accepts multipart/form-data with a `file` field (PNG, JPG, WebP,
 * or PDF) and returns the extracted W-2 fields. We do NOT persist
 * the file - the caller (the tax-profile form) takes the structured
 * result and pre-fills its inputs; the user reviews and saves.
 *
 * Auth: requires a signed-in user with at least the Filer plan, since
 * each call hits Anthropic and the W-2 forecasting feature itself is
 * Filer-and-above. The previous "no gate, cost is small" policy let
 * a free user batch-upload an arbitrary number of W-2s.
 *
 * Password-protected PDFs: if the upload is a locked PDF and no
 * password is supplied (or Anthropic rejects it), return 422 with
 * `{ error: "pdf_password_required" }` so the UI can pop a password
 * prompt and retry. On retry, the form includes a `password` field;
 * we decrypt locally with pdfjs, render pages to PNGs, and send the
 * images to Claude instead of the sealed PDF.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  if (!checkRateLimit(`w2-ocr:${user.id}`, { capacity: 12, refillPerMinute: 12 })) {
    return NextResponse.json(
      { error: "Too many requests — please slow down." },
      { status: 429 },
    );
  }

  // W-2 OCR is part of the personal forecasting feature, which the
  // Filer plan unlocks. Gate before touching Anthropic so a free user
  // can't burn API credits via the upload form.
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

  const password = (formData.get("password") as string | null)?.toString() ?? "";

  // Read as base64 in memory - we never write the file to disk or
  // storage. For PDFs > 4 MB Anthropic's API gets unhappy; we
  // clamp earlier on file.size.
  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");

  // If the user already supplied a password, jump straight to the
  // decrypt-and-render path so we never hand a locked PDF to
  // Anthropic (which would just bounce it again).
  if (password && file.type === "application/pdf") {
    try {
      const pages = await decryptAndRenderPdf(new Uint8Array(buf), password);
      const result = await extractW2FromImagePages({ pages });
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
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("ANTHROPIC_API_KEY")) {
        return NextResponse.json(
          { error: "Bella isn't configured on the server yet. Use manual entry for now." },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  try {
    const result = await extractW2FromImage({
      base64,
      mimeType: file.type as
        | "image/png"
        | "image/jpeg"
        | "image/webp"
        | "application/pdf",
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PdfPasswordRequiredError) {
      return NextResponse.json(
        { error: "pdf_password_required", reason: "missing" },
        { status: 422 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    // Don't leak the Anthropic error verbatim if it's about API keys
    // - keep the message helpful for the user.
    if (message.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json(
        { error: "Bella isn't configured on the server yet. Use manual entry for now." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
