"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { parseDollarsToCents, formatCents } from "@/lib/tax/forecast";
import { logCompanyActivity } from "@/lib/activity/log";

async function userBelongsToCompany(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  userId: string,
  companyId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("company_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  return !!data;
}

const VALID_RECURRENCES = new Set([
  "one_off",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
]);

export async function addIncome(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const taxYear = Number(formData.get("tax_year"));
  const month = Number(formData.get("month"));
  const source = String(formData.get("source") ?? "sales");
  const cents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const recurrenceRaw = String(formData.get("recurrence") ?? "one_off");
  const recurrence = VALID_RECURRENCES.has(recurrenceRaw)
    ? recurrenceRaw
    : "one_off";

  if (!companyId || !taxYear || !month || cents === null || cents <= 0) {
    throw new Error("Invalid input");
  }
  // Reject future-dated entries and entries from other tax years.
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (taxYear !== currentYear) {
    throw new Error("You can only add entries for the current tax year.");
  }
  if (month < 1 || month > 12 || month > currentMonth) {
    throw new Error("You cannot add entries for a future month.");
  }
  if (!(await userBelongsToCompany(admin, user.id, companyId))) {
    throw new Error("Not a member of this company");
  }

  const { error } = await admin.from("monthly_income").insert({
    company_id: companyId,
    user_id: user.id,
    tax_year: taxYear,
    month,
    amount_cents: cents,
    source,
    recurrence,
    notes,
  });
  if (error) throw new Error(error.message);

  await logCompanyActivity(admin, {
    companyId,
    actorUserId: user.id,
    kind: "income.created",
    summary: `Added ${formatCents(cents)} income (${source}), month ${month}`,
    payload: { month, amount_cents: cents, source, recurrence },
  });

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/income`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}

// Round-5 audit Medium: rows had Remove but no Edit. Power users
// fixing a typo had to delete + re-enter, which loses cadence /
// notes / source metadata and risks double-counting in the window
// between the delete and the re-add. updateIncome accepts the same
// fields as addIncome plus the row id; it validates the row belongs
// to the current user and rejects future-dated edits + entries from
// other tax years on the same rules as addIncome.
export async function updateIncome(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  const taxYear = Number(formData.get("tax_year"));
  const month = Number(formData.get("month"));
  const source = String(formData.get("source") ?? "sales");
  const cents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const recurrenceRaw = String(formData.get("recurrence") ?? "one_off");
  const recurrence = VALID_RECURRENCES.has(recurrenceRaw)
    ? recurrenceRaw
    : "one_off";

  if (!id || !companyId || !taxYear || !month || cents === null || cents <= 0) {
    throw new Error("Invalid input");
  }
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (taxYear !== currentYear) {
    throw new Error("You can only edit entries for the current tax year.");
  }
  if (month < 1 || month > 12 || month > currentMonth) {
    throw new Error("You cannot move an entry to a future month.");
  }
  if (!(await userBelongsToCompany(admin, user.id, companyId))) {
    throw new Error("Not a member of this company");
  }

  // Scope the update by id + user_id so a user can only edit their
  // own rows. RLS would also enforce this, but matching the delete
  // path's pattern keeps the surface auditable.
  const { error } = await admin
    .from("monthly_income")
    .update({
      month,
      amount_cents: cents,
      source,
      recurrence,
      notes,
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  await logCompanyActivity(admin, {
    companyId,
    actorUserId: user.id,
    kind: "income.updated",
    summary: `Updated an income entry to ${formatCents(cents)}, month ${month}`,
    payload: { id, month, amount_cents: cents, source, recurrence },
  });

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/income`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}

export async function deleteIncome(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Capture the amount before deleting so the activity log can say what
  // was removed (the audit's "who deleted a transaction" concern).
  const { data: existing } = await admin
    .from("monthly_income")
    .select("amount_cents, month")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  // Scope delete by user_id so a user can only delete their own entries.
  // Managers can delete via the admin/management UI separately.
  const { error } = await admin
    .from("monthly_income")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  if (existing) {
    await logCompanyActivity(admin, {
      companyId,
      actorUserId: user.id,
      kind: "income.deleted",
      summary: `Deleted ${formatCents(existing.amount_cents)} income, month ${existing.month}`,
      payload: { id, ...existing },
    });
  }

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/income`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}
