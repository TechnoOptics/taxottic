import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractW2FromImage } from "@/lib/ocr/extract-w2";

export const runtime = "nodejs";
// 50 MB upload cap.
export const maxDuration = 60;

/**
 * Accepts multipart/form-data with a `file` field (PNG, JPG, WebP,
 * or PDF) and returns the extracted W-2 fields. We do NOT persist
 * the file - the caller (the tax-profile form) takes the structured
 * result and pre-fills its inputs; the user reviews and saves.
 *
 * Auth: requires a signed-in user. Anyone signed in can use this -
 * no plan gate, since prefilling the tax profile saves us support
 * tickets and the per-call cost is small (~$0.01).
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

  // Read as base64 in memory - we never write the file to disk or
  // storage. For PDFs > 4 MB Anthropic's API gets unhappy; we
  // clamp earlier on file.size.
  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");

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
