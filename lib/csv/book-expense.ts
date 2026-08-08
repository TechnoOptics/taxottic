// Booking one bank transaction as one expense, exactly once.
//
// ---------------------------------------------------------------------
// WHAT WENT WRONG
// ---------------------------------------------------------------------
// 2026-08-06. Both booking paths did this:
//
//   const { data: created } = await admin.from("monthly_expenses").insert(...)
//   await admin.from("bank_transactions").update({ applied_expense_id: created.id })
//
// Between those two awaits the transaction still reads as unbooked, so a
// concurrent run inserts a second expense. applied_expense_id holds one
// id, so the loser is orphaned: invisible on every screen, still counted
// in every deduction total. One company ended up with 32 such rows worth
// $25,061.22, inserted at 18:40:08.05693+00 and re-inserted at 18:40:29,
// inflating July's deductions by 45%.
//
// ---------------------------------------------------------------------
// WHAT THIS IS
// ---------------------------------------------------------------------
// One place both paths call, which claims the transaction and writes the
// expense inseparably. The real guarantee lives in the database:
// monthly_expenses.source_transaction_id is UNIQUE where not null, so a
// second expense for the same transaction cannot be inserted at all,
// whatever this file or any future caller does.
//
// The fallback below exists because migrations in this repo are applied
// by a human after the code merges (docs/migration-history-state.md).
// Between the merge and the apply the import has to keep working. The
// fallback is NOT as safe as the function: it narrows the window with a
// compare-and-swap on the link and cleans up after itself when it loses,
// but it cannot make the two writes one. It is a bridge, and it stops
// mattering the moment 20260808020000 is applied.

import { interpretBookingClaim } from "./expense-booking";

type Admin = ReturnType<
  typeof import("@/lib/supabase/server").createServiceClient
>;

export type BookExpenseArgs = {
  transactionId: string;
  /**
   * The transaction's company.
   *
   * Only the fallback needs it: the claim function re-derives the
   * company from the transaction itself, precisely so a caller cannot
   * book an expense onto the wrong company by passing the wrong id.
   */
  companyId: string;
  /** Who pressed the button, recorded as monthly_expenses.user_id. */
  actorUserId: string;
  taxYear: number;
  /** 1-12, from the transaction's posted date. */
  month: number;
  /** Always positive. planExpenseBooking has already done the sign work. */
  amountCents: number;
  categoryCode: string;
  recurrence: "monthly" | "one_off";
  notes: string;
};

export type BookExpenseResult = {
  status: "booked" | "already_booked" | "failed";
  expenseId: string | null;
};

/**
 * Book one transaction as one expense.
 *
 * Never writes a second expense for a transaction that already has one.
 * A repeat attempt reports `already_booked`, which the caller counts as
 * a skip, not a failure: the row is booked exactly once, which is the
 * outcome that was asked for.
 */
export async function bookExpenseForTransaction(
  admin: Admin,
  args: BookExpenseArgs,
): Promise<BookExpenseResult> {
  const claim = interpretBookingClaim(
    await admin.rpc("book_bank_transaction_expense", {
      p_transaction_id: args.transactionId,
      p_actor_user_id: args.actorUserId,
      p_tax_year: args.taxYear,
      p_month: args.month,
      p_amount_cents: args.amountCents,
      p_category_code: args.categoryCode,
      p_recurrence: args.recurrence,
      p_notes: args.notes,
    }),
  );

  if (!claim.functionMissing) {
    return { status: claim.status, expenseId: claim.expenseId };
  }
  return bookWithoutClaimFunction(admin, args);
}

/**
 * The pre-migration path, with the race narrowed as far as two round
 * trips allow.
 *
 * The difference from the code this replaces is the `.is("applied_
 * expense_id", null)` on the link: the update only lands if the
 * transaction is still unbooked, so a run that loses the race writes
 * nothing to bank_transactions and deletes the expense it had just
 * inserted instead of leaving it orphaned. The window where two expenses
 * exist at once is still real; it is now measured in one round trip and
 * always ends with one of them deleted.
 */
async function bookWithoutClaimFunction(
  admin: Admin,
  args: BookExpenseArgs,
): Promise<BookExpenseResult> {
  const { data: existing } = await admin
    .from("bank_transactions")
    .select("applied_expense_id")
    .eq("id", args.transactionId)
    .maybeSingle();
  if (existing?.applied_expense_id) {
    return {
      status: "already_booked",
      expenseId: existing.applied_expense_id as string,
    };
  }

  const { data: created, error: insErr } = await admin
    .from("monthly_expenses")
    .insert({
      company_id: args.companyId,
      user_id: args.actorUserId,
      tax_year: args.taxYear,
      month: args.month,
      amount_cents: args.amountCents,
      category_code: args.categoryCode,
      recurrence: args.recurrence,
      notes: args.notes,
    })
    .select("id")
    .single();
  if (insErr || !created) return { status: "failed", expenseId: null };

  const { data: linked, error: linkErr } = await admin
    .from("bank_transactions")
    .update({
      applied_expense_id: created.id,
      applied_category_code: args.categoryCode,
    })
    .eq("id", args.transactionId)
    .is("applied_expense_id", null)
    .select("id");

  if (linkErr) {
    // Nothing points at the expense we just wrote. Remove it rather than
    // leave an orphan on the deduction surface.
    await admin.from("monthly_expenses").delete().eq("id", created.id);
    return { status: "failed", expenseId: null };
  }
  if (!linked || linked.length === 0) {
    // Somebody else booked this transaction between our read and our
    // write. Their row is the one the transaction points at, so ours is
    // the duplicate and it goes.
    await admin.from("monthly_expenses").delete().eq("id", created.id);
    return { status: "already_booked", expenseId: null };
  }

  return { status: "booked", expenseId: created.id as string };
}
