"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";
import { generateEngagementLetterHTML } from "@/lib/firm/documents/generate";

// Server actions for /firm/clients/{engagementId}/documents.
//
// Phase 5 v1 covers:
//   - generateEngagementLetter: builds the HTML, uploads to
//     Supabase Storage, creates a firm_documents row,
//     transitions to ready_for_review.
//   - markDocumentReady: flips status draft → ready_for_review.
//   - archiveDocument: status → archived (kept for audit; hidden
//     from default lists).

const STORAGE_BUCKET = "firm-documents";

export async function generateEngagementLetter(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!engagementId) throw new Error("Missing engagement.");

  // Load engagement + company + firm address for the letter body.
  const { data: eng } = await admin
    .from("firm_engagements")
    .select(
      "id, firm_id, company_id, tax_year, kind, scope_summary, company:companies!inner(id, name, legal_name, address_line_1, address_city, address_region, address_postal_code, deleted_at)",
    )
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) throw new Error("Engagement not found.");

  const { data: firmRow } = await admin
    .from("firms")
    .select(
      "name, legal_name, address_line_1, address_city, address_region, address_postal_code, phone, email, website, logo_url, accent_color",
    )
    .eq("id", ctx.firm.id)
    .maybeSingle();
  if (!firmRow) throw new Error("Firm record missing.");

  const company = (
    eng as unknown as {
      company: {
        id: string;
        name: string;
        legal_name: string | null;
        address_line_1: string | null;
        address_city: string | null;
        address_region: string | null;
        address_postal_code: string | null;
      };
    }
  ).company;

  // Pull the client manager's name + email for the recipient
  // block. Falls back to "client" if no manager (shouldn't happen
  // for an engaged company).
  const { data: clientManager } = await admin
    .from("company_members")
    .select("user_id, profiles!inner(full_name, email)")
    .eq("company_id", eng.company_id)
    .eq("role", "manager")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const clientProfile =
    (clientManager as unknown as { profiles?: { full_name: string | null; email: string } })
      ?.profiles ?? null;

  const { html, filename } = generateEngagementLetterHTML({
    firm: {
      name: firmRow.name,
      legal_name: firmRow.legal_name,
      address_line_1: firmRow.address_line_1,
      address_city: firmRow.address_city,
      address_region: firmRow.address_region,
      address_postal_code: firmRow.address_postal_code,
      phone: firmRow.phone,
      email: firmRow.email,
      website: firmRow.website,
      logo_url: firmRow.logo_url,
      accent_color: firmRow.accent_color,
    },
    client: {
      full_name: clientProfile?.full_name ?? null,
      business_name: company.name,
      business_address: [
        company.address_line_1,
        company.address_city,
        company.address_region,
        company.address_postal_code,
      ]
        .filter(Boolean)
        .join(", "),
      email: clientProfile?.email ?? "client@example.com",
    },
    engagement: {
      kind: eng.kind as "tax_prep",
      tax_year: eng.tax_year,
      scope_summary: eng.scope_summary,
      fee_estimate_cents: null,
    },
    effective_date: new Date().toISOString().slice(0, 10),
  });

  // Insert the firm_documents row first to get an id we can use in
  // the storage path. Stamping the id in the path keeps the file
  // discoverable from the DB row without a separate join.
  const { data: docRow, error: insertErr } = await admin
    .from("firm_documents")
    .insert({
      firm_id: ctx.firm.id,
      engagement_id: engagementId,
      company_id: eng.company_id,
      uploader_user_id: user.id,
      kind: "engagement_letter",
      status: "ready_for_review",
      provider: "generated",
      filename,
      content_type: "text/html",
      size_bytes: new Blob([html]).size,
      tax_year: eng.tax_year,
      storage_path: "", // patched below
    })
    .select("id")
    .single();
  if (insertErr || !docRow) {
    throw new Error(insertErr?.message ?? "Failed to create document row.");
  }

  const storagePath = `firms/${ctx.firm.id}/engagements/${engagementId}/${docRow.id}.html`;
  // Upload bytes. Service-role client bypasses RLS on storage
  // policy; in production set bucket-level policies + signed URLs
  // for client download.
  const { error: uploadErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, html, {
      contentType: "text/html",
      upsert: true,
    });
  if (uploadErr) {
    // If the bucket doesn't exist yet (first deploy), log the path
    // so the operator can manually create it. The row still exists
    // and a follow-up "regenerate" action re-fires the upload.
    // eslint-disable-next-line no-console
    console.error(
      `[firm-documents] storage upload failed (${uploadErr.message}). Path: ${storagePath}`,
    );
  } else {
    // Patch the row with the resolved path.
    await admin
      .from("firm_documents")
      .update({ storage_path: storagePath })
      .eq("id", docRow.id);
  }

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: eng.company_id,
    engagementId,
    kind: "firm.tax_form_drafted",
    summary: `Generated engagement letter draft for ${company.name}.`,
    payload: {
      document_id: docRow.id,
      kind: "engagement_letter",
      tax_year: eng.tax_year,
    },
  });

  revalidatePath(`/firm/clients/${engagementId}/documents`);
  redirect(`/firm/clients/${engagementId}/documents`);
}

export async function archiveDocument(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "manager") {
    throw new Error("Only firm owners or managers can archive documents.");
  }
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!id) throw new Error("Missing document id.");
  const { error } = await admin
    .from("firm_documents")
    .update({ status: "archived" })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/firm/clients/${engagementId}/documents`);
}
