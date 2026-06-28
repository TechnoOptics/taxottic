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
