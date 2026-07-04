"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { parseDollarsToCents, formatCents } from "@/lib/tax/forecast";
import { logCompanyActivity } from "@/lib/activity/log";
import { notify } from "@/lib/push";

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

// A manager can review any teammate's expense; a department lead can
// review only a teammate in their own department. Mirrors the
// is_department_lead_of_user() RLS function so app-level authorization
// and the database policy agree, this check just lets us return a
// clear error message instead of a generic RLS failure.
async function userCanReviewExpenseOwner(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  callerUserId: string,
  companyId: string,
  targetUserId: string,
): Promise<boolean> {
  const { data: caller } = await admin
    .from("company_members")
    .select("role, department_id")
    .eq("user_id", callerUserId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!caller) return false;
  if (caller.role === "manager") return true;
  if (caller.role === "lead" && caller.department_id) {
    const { data: target } = await admin
      .from("company_members")
      .select("department_id")
      .eq("user_id", targetUserId)
      .eq("company_id", companyId)
      .maybeSingle();
    return target?.department_id === caller.department_id;
  }
  return false;
}

const VALID_RECURRENCES = new Set([
  "one_off",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
]);

export async function addExpense(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const taxYear = Number(formData.get("tax_year"));
  const month = Number(formData.get("month"));
  const categoryCode = String(formData.get("category_code") ?? "");
  const cents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const recurrenceRaw = String(formData.get("recurrence") ?? "one_off");
  const recurrence = VALID_RECURRENCES.has(recurrenceRaw)
    ? recurrenceRaw
    : "one_off";

  if (
    !companyId ||
    !taxYear ||
    !month ||
    !categoryCode ||
    cents === null ||
    cents <= 0
  ) {
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

  const { data: inserted, error } = await admin
    .from("monthly_expenses")
    .insert({
      company_id: companyId,
      user_id: user.id,
      tax_year: taxYear,
      month,
      amount_cents: cents,
      category_code: categoryCode,
      recurrence,
      notes,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Phase-3 producer. Meals are 50%-limited and substantiation-
  // sensitive, so ask "was this business?"; everything else is a
  // quiet "added" FYI. Idempotent + no-op until push creds exist.
  if (inserted?.id) {
    await notify(
      user.id,
      categoryCode === "meals"
        ? { kind: "clarify", subject: "meal", refId: inserted.id }
        : { kind: "expense_applied", refId: inserted.id },
    );
  }

  await logCompanyActivity(admin, {
    companyId,
    actorUserId: user.id,
    kind: "expense.created",
    summary: `Added ${formatCents(cents)} expense (${categoryCode}), month ${month}`,
    payload: { month, amount_cents: cents, category_code: categoryCode, recurrence },
  });

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/expenses`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}

// Round-5 audit Medium: see app/c/[publicId]/income/actions.ts for
// the matching rationale. updateExpense edits an existing row's
// month / category / amount / recurrence / notes in place so a
// typo correction doesn't lose cadence metadata and doesn't risk
// double-counting in the delete-then-re-add window.
export async function updateExpense(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  const taxYear = Number(formData.get("tax_year"));
  const month = Number(formData.get("month"));
  const categoryCode = String(formData.get("category_code") ?? "");
  const cents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const recurrenceRaw = String(formData.get("recurrence") ?? "one_off");
  const recurrence = VALID_RECURRENCES.has(recurrenceRaw)
    ? recurrenceRaw
    : "one_off";

  if (
    !id ||
    !companyId ||
    !taxYear ||
    !month ||
    !categoryCode ||
    cents === null ||
    cents <= 0
  ) {
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

  const { error } = await admin
    .from("monthly_expenses")
    .update({
      month,
      amount_cents: cents,
      category_code: categoryCode,
      recurrence,
      notes,
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  await logCompanyActivity(admin, {
    companyId,
    actorUserId: user.id,
    kind: "expense.updated",
    summary: `Updated an expense to ${formatCents(cents)} (${categoryCode}), month ${month}`,
    payload: { id, month, amount_cents: cents, category_code: categoryCode, recurrence },
  });

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/expenses`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}

// Manager (or department-lead, scoped to their own department) review
// actions. Reviewing a teammate's logged expenses can leave a note
// (visible to the teammate, distinct from the teammate's own `notes`)
// and/or reclassify a miscategorized personal purchase out of the
// business deduction entirely, without deleting the row, so the
// teammate's own log stays intact.
export async function setExpenseClassification(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  const classificationRaw = String(formData.get("classification") ?? "");
  if (!id || !companyId) throw new Error("Invalid input");
  if (classificationRaw !== "business" && classificationRaw !== "personal") {
    throw new Error("Invalid classification");
  }

  const { data: existing } = await admin
    .from("monthly_expenses")
    .select("amount_cents, month, category_code, user_id")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!existing) throw new Error("Expense not found");
  if (
    !(await userCanReviewExpenseOwner(admin, user.id, companyId, existing.user_id))
  ) {
    throw new Error(
      "Only a manager, or that teammate's department lead, can reclassify this expense",
    );
  }

  const { error } = await admin
    .from("monthly_expenses")
    .update({ classification: classificationRaw })
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);

  if (existing) {
    await logCompanyActivity(admin, {
      companyId,
      actorUserId: user.id,
      kind: "expense.reclassified",
      summary: `Marked ${formatCents(existing.amount_cents)} expense (${existing.category_code}) as ${classificationRaw}`,
      payload: { id, classification: classificationRaw, ...existing },
    });
  }

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/expenses`);
    revalidatePath(`/c/${company.public_id}/forecast`);
    revalidatePath(`/c/${company.public_id}/forecast/breakdown`);
  }
}

export async function setExpenseManagerNote(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  const note = String(formData.get("manager_note") ?? "").trim() || null;
  if (!id || !companyId) throw new Error("Invalid input");

  const { data: existing } = await admin
    .from("monthly_expenses")
    .select("user_id")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!existing) throw new Error("Expense not found");
  if (
    !(await userCanReviewExpenseOwner(admin, user.id, companyId, existing.user_id))
  ) {
    throw new Error(
      "Only a manager, or that teammate's department lead, can leave a note on this expense",
    );
  }

  const { error } = await admin
    .from("monthly_expenses")
    .update({ manager_note: note })
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) revalidatePath(`/c/${company.public_id}/expenses`);
}

// "Or if the user says so", the manual half of recurring-expense
// control. The automated bank-sync detector (lib/banking/recurring.ts)
// catches a subscription that's gone quiet; this lets the person who
// logged it (or a manager) end the projection immediately, e.g. right
// when they cancel it, without waiting for the next sync to notice.
// endMonth defaults to the CURRENT calendar month so past months stay
// intact and only the forward projection stops; pass 0/omit to clear
// a previously-set end and let it project through December again.
export async function setExpenseRecurrenceEnd(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  const clear = formData.get("clear") === "1";
  if (!id || !companyId) throw new Error("Invalid input");

  const { data: existing } = await admin
    .from("monthly_expenses")
    .select("user_id, month, category_code, amount_cents")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!existing) throw new Error("Expense not found");

  const isOwner = existing.user_id === user.id;
  const canReview = await userCanReviewExpenseOwner(
    admin,
    user.id,
    companyId,
    existing.user_id,
  );
  if (!isOwner && !canReview) {
    throw new Error("Not allowed to change this expense's recurrence");
  }

  const currentMonth = new Date().getUTCMonth() + 1;
  const { error } = await admin
    .from("monthly_expenses")
    .update({ recurrence_end_month: clear ? null : currentMonth })
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);

  await logCompanyActivity(admin, {
    companyId,
    actorUserId: user.id,
    kind: clear ? "expense.recurrence_resumed" : "expense.recurrence_stopped",
    summary: clear
      ? `Resumed projecting a recurring expense (${existing.category_code})`
      : `Stopped projecting a recurring expense (${existing.category_code}) after month ${currentMonth}`,
    payload: { id, recurrence_end_month: clear ? null : currentMonth },
  });

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/expenses`);
    revalidatePath(`/c/${company.public_id}/forecast`);
    revalidatePath(`/c/${company.public_id}/forecast/breakdown`);
  }
}

export async function deleteExpense(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Capture what's being removed for the audit trail.
  const { data: existing } = await admin
    .from("monthly_expenses")
    .select("amount_cents, month, category_code")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = await admin
    .from("monthly_expenses")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  if (existing) {
    await logCompanyActivity(admin, {
      companyId,
      actorUserId: user.id,
      kind: "expense.deleted",
      summary: `Deleted ${formatCents(existing.amount_cents)} expense (${existing.category_code}), month ${existing.month}`,
      payload: { id, ...existing },
    });
  }

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/expenses`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}
