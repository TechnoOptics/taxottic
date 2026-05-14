"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";

// Tier 2 #6: Document-comment server actions.
//
// Three flows:
//   - postComment(documentId, body, [page_number]): firm member
//     leaves a comment anchored to a document, optionally to a page.
//   - resolveComment(id): marks a comment resolved (review done).
//   - reopenComment(id): undoes a resolve when the reviewer disagrees.
//
// We don't expose delete intentionally — comments are part of the
// engagement audit trail. Firms can soft-resolve when wrong.

export async function postComment(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const documentId = String(formData.get("document_id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const pageNumberRaw = formData.get("page_number");
  const pageNumber =
    pageNumberRaw && /^\d+$/.test(String(pageNumberRaw))
      ? Math.min(9999, parseInt(String(pageNumberRaw), 10))
      : null;

  if (!documentId) throw new Error("Missing document id.");
  if (!body || body.length > 4000) {
    throw new Error("Comment must be 1-4000 characters.");
  }

  // Confirm the doc belongs to this firm before writing.
  const { data: doc } = await admin
    .from("firm_documents")
    .select("id, firm_id, engagement_id, company_id, kind")
    .eq("id", documentId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!doc) throw new Error("Document not found.");

  const { error } = await admin.from("firm_document_comments").insert({
    document_id: documentId,
    firm_id: ctx.firm.id,
    author_id: user.id,
    body,
    page_number: pageNumber,
  });
  if (error) throw new Error(error.message);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: doc.company_id ?? null,
    engagementId: doc.engagement_id ?? null,
    kind: "firm.note_added",
    summary: `Comment left on ${doc.kind} document.`,
    payload: { document_id: documentId, page_number: pageNumber },
  });

  revalidatePath(
    `/firm/clients/${engagementId}/documents/${documentId}/comments`,
  );
}

export async function resolveComment(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const id = String(formData.get("id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!id) throw new Error("Missing comment id.");

  await admin
    .from("firm_document_comments")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);

  revalidatePath(
    `/firm/clients/${engagementId}/documents/${documentId}/comments`,
  );
}

export async function reopenComment(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const id = String(formData.get("id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!id) throw new Error("Missing comment id.");

  await admin
    .from("firm_document_comments")
    .update({ resolved_at: null, resolved_by: null })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);

  revalidatePath(
    `/firm/clients/${engagementId}/documents/${documentId}/comments`,
  );
}
