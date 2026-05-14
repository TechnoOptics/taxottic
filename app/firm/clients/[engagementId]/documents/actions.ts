"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";
import { generateEngagementLetterHTML } from "@/lib/firm/documents/generate";
import {
  loadScheduleCData,
  renderScheduleCHTML,
} from "@/lib/firm/documents/generate-schedule-c";

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

// Phase 11: auto-drafted Schedule C. Reads the client's books for
// the engagement's tax_year, maps every category to its IRS
// schedule_c_line, applies the 50% meals limitation, and writes a
// review-ready HTML draft to storage. The preparer reviews,
// fills Part III/IV/V if needed, and prints to PDF for filing.
export async function generateScheduleCDraft(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!engagementId) throw new Error("Missing engagement.");

  const { data: eng } = await admin
    .from("firm_engagements")
    .select(
      "id, firm_id, company_id, tax_year, kind, company:companies!inner(id, name, legal_name, ein, entity_type, address_line_1, address_city, address_region, address_postal_code, deleted_at)",
    )
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) throw new Error("Engagement not found.");
  const company = (
    eng as unknown as {
      company: {
        id: string;
        name: string;
        legal_name: string | null;
        ein: string | null;
        entity_type: string | null;
        address_line_1: string | null;
        address_city: string | null;
        address_region: string | null;
        address_postal_code: string | null;
        deleted_at: string | null;
      };
    }
  ).company;

  // Schedule C is for sole proprietors + single-member LLCs taxed
  // as disregarded entities. Block the action on entity types
  // that don't file it.
  const eligibleEntities = new Set([
    "sole_prop",
    "single_llc",
    "self_employed_1099",
  ]);
  if (
    company.entity_type &&
    !eligibleEntities.has(company.entity_type)
  ) {
    throw new Error(
      `Schedule C is for sole proprietors. This client is registered as ${company.entity_type}; use a different form.`,
    );
  }

  // Pull firm branding for the header.
  const { data: firmRow } = await admin
    .from("firms")
    .select("name, accent_color, logo_url")
    .eq("id", ctx.firm.id)
    .maybeSingle();
  if (!firmRow) throw new Error("Firm record missing.");

  // Pull the company owner's display name for the proprietor line.
  const { data: ownerRow } = await admin
    .from("company_members")
    .select("profiles!inner(full_name)")
    .eq("company_id", company.id)
    .eq("role", "manager")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const ownerName =
    (ownerRow as unknown as { profiles?: { full_name: string | null } })
      ?.profiles?.full_name ?? null;

  // Load aggregated income + expenses.
  const data = await loadScheduleCData(admin, company.id, eng.tax_year);

  const { html, filename } = renderScheduleCHTML({
    firm: {
      name: firmRow.name,
      accent_color: firmRow.accent_color,
      logo_url: firmRow.logo_url,
    },
    company: {
      name: company.name,
      legal_name: company.legal_name,
      ein: company.ein,
      address_line_1: company.address_line_1,
      address_city: company.address_city,
      address_region: company.address_region,
      address_postal_code: company.address_postal_code,
    },
    taxYear: eng.tax_year,
    owner: {
      full_name: ownerName,
      ssn: null,
    },
    income: {
      grossReceiptsCents: data.grossReceiptsCents,
      returnsCents: 0,
      otherIncomeCents: data.otherIncomeCents,
    },
    expensesByLine: data.expensesByLine,
    mealsDeductibleCents: data.mealsDeductibleCents,
    preparer: {
      full_name: (user.user_metadata?.full_name as string) ?? null,
      title: null,
      ptin: null,
    },
  });

  // Insert the document row, then upload bytes (same pattern as
  // the engagement-letter generator).
  const { data: docRow, error: insertErr } = await admin
    .from("firm_documents")
    .insert({
      firm_id: ctx.firm.id,
      engagement_id: engagementId,
      company_id: eng.company_id,
      uploader_user_id: user.id,
      kind: "schedule_c_draft",
      status: "ready_for_review",
      provider: "generated",
      filename,
      content_type: "text/html",
      size_bytes: new Blob([html]).size,
      tax_year: eng.tax_year,
      storage_path: "",
    })
    .select("id")
    .single();
  if (insertErr || !docRow) {
    throw new Error(insertErr?.message ?? "Failed to create document row.");
  }

  const storagePath = `firms/${ctx.firm.id}/engagements/${engagementId}/${docRow.id}.html`;
  const { error: uploadErr } = await admin.storage
    .from("firm-documents")
    .upload(storagePath, html, {
      contentType: "text/html",
      upsert: true,
    });
  if (uploadErr) {
    // eslint-disable-next-line no-console
    console.error(
      `[firm-documents] schedule-c upload failed (${uploadErr.message}). Path: ${storagePath}`,
    );
  } else {
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
    summary: `Drafted Schedule C for ${company.name} (tax year ${eng.tax_year}).`,
    payload: {
      document_id: docRow.id,
      kind: "schedule_c_draft",
      tax_year: eng.tax_year,
      gross_receipts_cents: data.grossReceiptsCents,
      total_expenses_cents: Array.from(data.expensesByLine.values()).reduce(
        (a, c) => a + c,
        0,
      ),
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
