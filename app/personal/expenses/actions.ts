"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parseDollarsToCents } from "@/lib/tax/forecast";
import { PERSONAL_EXPENSE_CODES } from "@/lib/tax/personal-expense-categories";

/**
 * Add a personal (individual-side) deductible expense. Owner-only: the row is
 * written through the RLS-bound client with user_id = the signed-in user, so
 * the database policy is the guardrail even if this code is wrong. See
 * supabase/migrations/20260704140000_personal_expenses.sql.
 */
export async function addPersonalExpense(formData: FormData) {
  const { supabase, user } = await requireUser();

  const category = String(formData.get("category") ?? "");
  const cents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const incurredOn = String(formData.get("incurred_on") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!PERSONAL_EXPENSE_CODES.has(category)) {
    throw new Error("Pick a valid category.");
  }
  if (cents === null || cents <= 0) {
    throw new Error("Enter an amount greater than zero.");
  }
  // Basic YYYY-MM-DD sanity; the column is a date so Postgres rejects garbage,
  // but this gives a friendly message and a sensible default (today) when the
  // field is left blank.
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(incurredOn) ? incurredOn : null;
  if (!date) throw new Error("Pick the date the expense was incurred.");
  const taxYear = Number(date.slice(0, 4));

  const { error } = await supabase.from("personal_expenses").insert({
    user_id: user.id,
    tax_year: taxYear,
    category,
    amount_cents: cents,
    incurred_on: date,
    notes,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/personal/expenses");
  revalidatePath("/personal/forecast");
}

/** Delete one of the caller's own personal expenses. */
export async function deletePersonalExpense(formData: FormData) {
  const { supabase, user } = await requireUser();

  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id");

  const { error } = await supabase
    .from("personal_expenses")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/personal/expenses");
  revalidatePath("/personal/forecast");
}
