"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";

// Filings server actions.
//
// Three operations:
//   - recordFiling: create a `prepared` or `submitted` row from
//     scratch. Used when the firm files through the IRS portal or
//     an ERO and wants to record the result here.
//   - markAccepted / markRejected: lifecycle transitions once
//     the firm hears back from the authority.
//   - mefSubmit: placeholder for direct MeF e-file submission.
//     Phase 11.7 ships this as a stub that flips status to
//     `submitted` with `provider_submission_id` set to a generated
//     reference. Real MeF wiring lands when the firm completes
//     IRS EFIN application + ETIN approval.

const VALID_FORMS = new Set([
  "form_1040",
  "form_1040_x",
  "form_1065",
  "form_1120",
  "form_1120_s",
  "form_990",
  "form_941",
  "form_944",
  "form_940",
  "form_w2",
  "form_1099_nec",
  "form_1099_misc",
  "state_income",
  "state_sales_tax",
  "other",
]);

const VALID_STATUSES = new Set([
  "prepared",
  "queued",
  "submitted",
  "accepted",
  "rejected",
  "amended",
  "cancelled",
]);

export async function recordFiling(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!engagementId) throw new Error("Missing engagement.");

  const form = String(formData.get("form") ?? "");
  if (!VALID_FORMS.has(form)) throw new Error("Invalid form type.");
  const status = String(formData.get("status") ?? "prepared");
  if (!VALID_STATUSES.has(status)) throw new Error("Invalid status.");

  const taxYearRaw = Number(formData.get("tax_year"));
  const tax_year =
    Number.isFinite(taxYearRaw) && taxYearRaw >= 2020 && taxYearRaw <= 2100
      ? Math.floor(taxYearRaw)
      : new Date().getUTCFullYear();

  const jurisdictionRaw = String(formData.get("jurisdiction") ?? "federal");
  const jurisdiction =
    jurisdictionRaw === "federal" || /^[A-Z]{2}$/.test(jurisdictionRaw)
      ? jurisdictionRaw
      : "federal";

  const periodEnd =
    String(formData.get("period_end") ?? "").trim() || null;
  const documentId = String(formData.get("document_id") ?? "").trim() || null;
  const submissionTarget =
    String(formData.get("submission_target") ?? "").trim() || null;
  const providerSubmissionId =
    String(formData.get("provider_submission_id") ?? "").trim() || null;
  const preparerPtin =
    String(formData.get("preparer_ptin") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const { data: eng } = await admin
    .from("firm_engagements")
    .select("company_id")
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) throw new Error("Engagement not found.");

  const insertRow: Record<string, unknown> = {
    firm_id: ctx.firm.id,
    engagement_id: engagementId,
    company_id: eng.company_id,
    document_id: documentId,
    form,
    tax_year,
    period_end: periodEnd,
    jurisdiction,
    status,
    submission_target: submissionTarget,
    provider_submission_id: providerSubmissionId,
    preparer_user_id: user.id,
    preparer_ptin: preparerPtin,
    notes,
  };
  if (status === "submitted" || status === "accepted") {
    insertRow.submitted_at = new Date().toISOString();
  }
  if (status === "accepted") {
    insertRow.accepted_at = new Date().toISOString();
  }

  const { data: inserted, error } = await admin
    .from("firm_efilings")
    .insert(insertRow)
    .select("id, form")
    .single();
  if (error || !inserted) throw new Error(error?.message ?? "Insert failed.");

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: eng.company_id,
    engagementId,
    kind: status === "accepted" ? "firm.tax_form_filed" : "firm.tax_form_drafted",
    summary: `${prettyForm(form)} ${prettyStatus(status)} for tax year ${tax_year}.`,
    payload: { efiling_id: inserted.id, form, status, tax_year },
  });

  revalidatePath(`/firm/clients/${engagementId}/filings`);
  redirect(`/firm/clients/${engagementId}/filings`);
}

export async function updateFilingStatus(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !VALID_STATUSES.has(status)) {
    throw new Error("Invalid input.");
  }
  const rejectReason =
    String(formData.get("reject_reason") ?? "").trim() || null;

  const patch: Record<string, unknown> = { status };
  if (status === "submitted") {
    patch.submitted_at = new Date().toISOString();
  }
  if (status === "accepted") {
    patch.accepted_at = new Date().toISOString();
  }
  if (status === "rejected") {
    patch.rejected_at = new Date().toISOString();
    if (rejectReason) patch.reject_reason = rejectReason;
  }

  const { data: row } = await admin
    .from("firm_efilings")
    .select("firm_id, engagement_id, company_id, form, tax_year")
    .eq("id", id)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!row) throw new Error("Filing not found.");

  const { error } = await admin
    .from("firm_efilings")
    .update(patch)
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);
  if (error) throw new Error(error.message);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: row.company_id,
    engagementId: row.engagement_id,
    kind: status === "accepted" ? "firm.tax_form_filed" : "firm.note_added",
    summary: `${prettyForm(row.form as string)} ${prettyStatus(status)}${rejectReason ? `: ${rejectReason}` : ""}.`,
    payload: { efiling_id: id, status, tax_year: row.tax_year },
  });

  revalidatePath(`/firm/clients/${engagementId}/filings`);
}

/**
 * Placeholder for direct IRS MeF submission. Phase 11.7 ships
 * this as a structured stub: it flips status to `submitted` and
 * generates a synthetic provider_submission_id so the UI can
 * exercise the full lifecycle.
 *
 * When we wire actual MeF, this function:
 *   1. Pulls the PDF + form data from the linked document.
 *   2. Builds the per-form MeF XML envelope.
 *   3. POSTs to the MeF provider's submission endpoint.
 *   4. Persists the IRS declaration control number + the
 *      acknowledgment XML.
 * The status transitions then come back via webhook from the
 * provider (similar to /api/webhooks/documenso shape).
 */
export async function submitViaMef(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const id = String(formData.get("id") ?? "");
  const engagementId = String(formData.get("engagement_id") ?? "");
  if (!id) throw new Error("Missing filing id.");

  const { data: row } = await admin
    .from("firm_efilings")
    .select("firm_id, engagement_id, company_id, form, tax_year, status")
    .eq("id", id)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!row) throw new Error("Filing not found.");
  if (row.status !== "prepared" && row.status !== "queued") {
    throw new Error(`Cannot submit a filing in status '${row.status}'.`);
  }

  // Tier 1 #6: emit a real MeF-shaped submission ID when EFIN is
  // configured for the firm. Falls back to the legacy synthetic
  // DCN format when EFIN isn't wired, so the demo loop keeps
  // working.
  const { generateSubmissionId } = await import("@/lib/firm/efile/mef");
  const efin = process.env.IRS_EFIN ?? "";
  const submissionId = efin
    ? generateSubmissionId(efin, Math.floor(Math.random() * 1_000_000))
    : `DCN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1_000_000).toString(36).toUpperCase()}`;
  await admin
    .from("firm_efilings")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      provider_submission_id: submissionId,
      submission_target: "IRS MeF (stub)",
    })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId: row.company_id,
    engagementId: row.engagement_id,
    kind: "firm.tax_form_filed",
    summary: `Submitted ${prettyForm(row.form as string)} for tax year ${row.tax_year} via MeF stub (${submissionId}).`,
    payload: {
      efiling_id: id,
      submission_id: submissionId,
      provider: "mef-stub",
    },
  });

  revalidatePath(`/firm/clients/${engagementId}/filings`);
}

function prettyForm(form: string): string {
  return (
    {
      form_1040: "Form 1040",
      form_1040_x: "Form 1040-X",
      form_1065: "Form 1065",
      form_1120: "Form 1120",
      form_1120_s: "Form 1120-S",
      form_990: "Form 990",
      form_941: "Form 941",
      form_944: "Form 944",
      form_940: "Form 940",
      form_w2: "W-2 batch",
      form_1099_nec: "1099-NEC batch",
      form_1099_misc: "1099-MISC batch",
      state_income: "State income return",
      state_sales_tax: "State sales-tax return",
      other: "Other filing",
    }[form] ?? form
  );
}

function prettyStatus(s: string): string {
  return (
    {
      prepared: "prepared",
      queued: "queued",
      submitted: "submitted",
      accepted: "accepted by the IRS",
      rejected: "rejected",
      amended: "amended",
      cancelled: "cancelled",
    }[s] ?? s
  );
}
