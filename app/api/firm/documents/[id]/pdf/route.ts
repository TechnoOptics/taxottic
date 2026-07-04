import { NextRequest, NextResponse } from "next/server";
import { requireUserWithAdmin } from "@/lib/auth";
import { renderHtmlToPdf } from "@/lib/firm/documents/render-pdf";

export const runtime = "nodejs";
// PDF rendering can be slow on the first cold-start while Chromium
// initializes; 60s is comfortable headroom.
export const maxDuration = 60;

/**
 * Stream a PDF of the document directly to the requester. Used by
 * the "Download PDF" button on the docs page + the e-sign envelope
 * upload path (Phase 11.7 hands the PDF bytes to Documenso/DocuSign).
 *
 * Authorization: the user must be a member of the firm OR a manager
 * of the company the document belongs to. We delegate the gate to
 * RLS on firm_documents, the service-role client used here would
 * bypass RLS, so we do an explicit membership check using the
 * supabase-from-auth client first.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, admin } = await requireUserWithAdmin();

  // RLS check: pull the row with the user's session client.
  const { data: rlsRow } = await supabase
    .from("firm_documents")
    .select("id, firm_id, storage_path, filename, content_type")
    .eq("id", id)
    .maybeSingle();
  if (!rlsRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Fetch the HTML from storage via service-role (RLS already
  // approved access via rlsRow).
  if (!rlsRow.storage_path) {
    return NextResponse.json({ error: "no_storage_path" }, { status: 400 });
  }
  const { data: blob, error: downloadErr } = await admin.storage
    .from("firm-documents")
    .download(rlsRow.storage_path);
  if (downloadErr || !blob) {
    return NextResponse.json(
      { error: `download_failed: ${downloadErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }
  const html = await blob.text();

  try {
    const pdf = await renderHtmlToPdf({ html });
    const niceName = rlsRow.filename.replace(/\.html?$/i, ".pdf");
    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${niceName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "render_failed" },
      { status: 500 },
    );
  }
}
