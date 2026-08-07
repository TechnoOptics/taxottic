"use client";

import { useState } from "react";
import {
  CategoryCombobox,
  type CategoryOption,
} from "@/components/CategoryCombobox";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { ArrowSwapIcon } from "@/components/ui/Icons";

/**
 * Move one BOOKED row across the income/expense divide.
 *
 * Requested by the owner: "PLEASE ALSO HAVE A FEATURE WHERE THE USER CAN
 * MOVE AN INCOME TO AN EXPENSE AND VICE VERSA". Until this existed the
 * only way back from a wrong booking was to delete the import and
 * re-upload it, which is why a $4,000 row booked as income on 2026-08-06
 * had to be corrected by hand in the SQL editor.
 *
 * Deliberately a closed disclosure, not a bare button. This restates a
 * filed number, so it should take a second click and a look at what is
 * about to happen. It matches the "Teach Bella this vendor" control that
 * already sits on every row.
 *
 * Moving TO an expense requires a category, because a category is what
 * makes a line a deduction: the submit button stays disabled until one
 * is picked, and the server action refuses the move regardless. Moving
 * TO income requires a source for the same reason, and it defaults to
 * Product sales rather than leaving the user to guess.
 */

const INCOME_SOURCES = [
  { value: "sales", label: "Product sales" },
  { value: "services", label: "Services / consulting" },
  { value: "wages_w2", label: "W-2 wages" },
  { value: "interest", label: "Interest" },
  { value: "dividends", label: "Dividends" },
  { value: "rental", label: "Rental income" },
  { value: "royalty", label: "Royalty / licensing" },
  { value: "other", label: "Other" },
];

type Props = {
  txId: string;
  importId: string;
  /** Where the row is going, not where it is. */
  direction: "to_income" | "to_expense";
  cats: CategoryOption[];
  frequentCodes: string[];
  moveBookedTransaction: (formData: FormData) => Promise<void>;
};

export function MoveBookedRow({
  txId,
  importId,
  direction,
  cats,
  frequentCodes,
  moveBookedTransaction,
}: Props) {
  const toExpense = direction === "to_expense";
  const [categoryCode, setCategoryCode] = useState("");

  return (
    <details className="mt-2">
      <summary className="text-[11px] text-forest-700 hover:text-forest-900 cursor-pointer select-none inline-flex items-center gap-1.5">
        <ArrowSwapIcon className="size-3.5" />
        {toExpense ? "Move to expenses" : "Move to income"}
      </summary>
      <form
        action={moveBookedTransaction}
        className="mt-2 grid gap-2 text-xs rounded-lg border border-forest-100 bg-white/60 p-3"
      >
        <input type="hidden" name="id" value={txId} />
        <input type="hidden" name="import_id" value={importId} />
        <input type="hidden" name="direction" value={direction} />

        <p className="text-[11px] text-ink-muted leading-relaxed">
          {toExpense
            ? "This entry comes out of your income for the month it was posted and becomes a deductible expense in the same month, for the same amount."
            : "This entry comes out of your deductions for the month it was posted and becomes income in the same month, for the same amount."}{" "}
          The change is recorded on the new entry with your name and the
          date, so a reviewer can see it was moved.
        </p>

        {toExpense ? (
          <label className="grid gap-1">
            <span className="text-ink-muted">
              Expense category (required, this is what makes it a deduction)
            </span>
            <CategoryCombobox
              name="category_code"
              defaultValue=""
              options={cats}
              frequentCodes={frequentCodes}
              placeholder="Pick a category…"
              autoSubmit={false}
              emptyLabel="- pick one -"
              onPick={setCategoryCode}
            />
          </label>
        ) : (
          <label className="grid gap-1">
            <span className="text-ink-muted">Income source</span>
            <SelectMenu
              name="income_source"
              ariaLabel="Income source"
              defaultValue="sales"
              options={INCOME_SOURCES}
            />
          </label>
        )}

        <label className="grid gap-1">
          <span className="text-ink-muted">Why (optional, kept on the entry)</span>
          <input
            name="reason"
            type="text"
            className="input"
            maxLength={200}
            placeholder="e.g. this was a legal fee, not a client payment"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            className="btn-ghost text-xs"
            disabled={toExpense && !categoryCode}
          >
            {toExpense ? "Move to expenses" : "Move to income"}
          </button>
          {toExpense && !categoryCode ? (
            <span className="text-[11px] text-ink-muted">
              Pick a category first.
            </span>
          ) : null}
        </div>
      </form>
    </details>
  );
}
