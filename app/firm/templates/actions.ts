"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import { logFirmActivity } from "@/lib/firm/activity";
import { computeNextIssueAt } from "@/lib/firm/invoice-templates/schedule";

// Tier 2 #2: Recurring invoice templates.
//
// The Phase 7 invoicing flow is one-shot, preparer drafts an
// invoice, hits "Send," done. Most firms have at least one client
// on a flat monthly retainer where typing the same line items
// every month is just toil. This action set lets the firm define
// a template with line items + cadence; the cron in
// app/api/cron/firm-invoice-issue/route.ts walks active templates
// and mints a fresh `firm_invoices` row when the cadence has
// elapsed.
//
// Three flows:
//   - createTemplate: insert with next_issue_at = first scheduled date.
//   - pauseTemplate / resumeTemplate: toggle `active` without
//     losing the line-item config.
//   - deleteTemplate: hard delete (the cron uses templates as
//     blueprints, not audit history).

type LineItem = {
  description: string;
  quantity: number;
  unit_amount_cents: number;
};

function parseLineItems(formData: FormData): LineItem[] {
  const descs = formData.getAll("line_desc").map((v) => String(v ?? "").trim());
  const qtys = formData.getAll("line_qty").map((v) => Number(v));
  const amts = formData
    .getAll("line_amount")
    .map((v) => parseAmountCents(String(v ?? "")));
  const items: LineItem[] = [];
  for (let i = 0; i < descs.length; i++) {
    const desc = descs[i];
    const qty = qtys[i];
    const amt = amts[i];
    if (
      !desc ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      amt === null ||
      amt <= 0
    ) {
      continue;
    }
    items.push({
      description: desc.slice(0, 200),
      quantity: Math.min(Math.floor(qty), 9999),
      unit_amount_cents: amt,
    });
  }
  return items;
}

function parseAmountCents(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export async function createTemplate(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();

  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 200) {
    throw new Error("Template name is required (1-200 chars).");
  }
  const engagementId =
    String(formData.get("engagement_id") ?? "").trim() || null;
  const recipientEmail = String(formData.get("recipient_email") ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) {
    throw new Error("Provide a valid recipient email.");
  }
  const recipientName =
    String(formData.get("recipient_name") ?? "").trim() || null;
  const cadenceRaw = String(formData.get("cadence") ?? "monthly");
  const cadence = (
    ["monthly", "quarterly", "annual"].includes(cadenceRaw)
      ? cadenceRaw
      : "monthly"
  ) as "monthly" | "quarterly" | "annual";
  const issueDayRaw = Number(formData.get("issue_day_of_month"));
  const issueDay =
    Number.isFinite(issueDayRaw) && issueDayRaw >= 1 && issueDayRaw <= 28
      ? Math.floor(issueDayRaw)
      : 1;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const lineItems = parseLineItems(formData);
  if (lineItems.length === 0) {
    throw new Error("Add at least one line item.");
  }

  let companyId: string | null = null;
  if (engagementId) {
    const { data: eng } = await admin
      .from("firm_engagements")
      .select("company_id")
      .eq("id", engagementId)
      .eq("firm_id", ctx.firm.id)
      .maybeSingle();
    if (!eng) throw new Error("Engagement not found.");
    companyId = eng.company_id;
  }

  const next = computeNextIssueAt({
    cadence,
    issueDayOfMonth: issueDay,
    reference: new Date(),
  });

  const { error } = await admin.from("firm_invoice_templates").insert({
    firm_id: ctx.firm.id,
    engagement_id: engagementId,
    company_id: companyId,
    name,
    line_items: lineItems,
    cadence,
    issue_day_of_month: issueDay,
    recipient_email: recipientEmail,
    recipient_name: recipientName,
    notes,
    next_issue_at: next.toISOString(),
    created_by: user.id,
  });
  if (error) throw new Error(error.message);

  await logFirmActivity({
    client: admin,
    firmId: ctx.firm.id,
    companyId,
    engagementId,
    kind: "firm.note_added",
    summary: `Created recurring invoice template "${name}" (${cadence}).`,
    payload: { cadence, next_issue_at: next.toISOString() },
  });

  revalidatePath("/firm/templates");
  redirect("/firm/templates");
}

export async function pauseTemplate(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");
  await admin
    .from("firm_invoice_templates")
    .update({ active: false })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);
  revalidatePath("/firm/templates");
}

export async function resumeTemplate(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");

  // Re-anchor next_issue_at to the next calendar slot when we resume,
  // so a paused-for-six-months template doesn't dump six invoices at
  // once when the firm flips it back on.
  const { data: tpl } = await admin
    .from("firm_invoice_templates")
    .select("cadence, issue_day_of_month")
    .eq("id", id)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!tpl) throw new Error("Template not found.");
  const next = computeNextIssueAt({
    cadence: tpl.cadence as "monthly" | "quarterly" | "annual",
    issueDayOfMonth: tpl.issue_day_of_month,
    reference: new Date(),
  });

  await admin
    .from("firm_invoice_templates")
    .update({ active: true, next_issue_at: next.toISOString() })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);
  revalidatePath("/firm/templates");
}

export async function deleteTemplate(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");
  await admin
    .from("firm_invoice_templates")
    .delete()
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);
  revalidatePath("/firm/templates");
}
