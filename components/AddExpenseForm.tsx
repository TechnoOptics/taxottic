"use client";

import { useState } from "react";
import { RecurrencePicker } from "./RecurrencePicker";

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "Add an expense" form. Client-side because the category select drives
 * the recurrence picker (e.g., picking "Rent" auto-flips it to recurring
 * monthly). The action prop is the addExpense server action passed in
 * from the page; React allows server actions to be threaded through
 * client components as props.
 */
export function AddExpenseForm({
  companyId,
  taxYear,
  currentMonth,
  categories,
  action,
}: {
  companyId: string;
  taxYear: number;
  currentMonth: number;
  categories: {
    code: string;
    label: string;
    is_meal: boolean;
    is_typically_recurring: boolean;
  }[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [categoryCode, setCategoryCode] = useState<string>("");
  const recurringHint =
    categories.find((c) => c.code === categoryCode)?.is_typically_recurring ??
    false;

  return (
    <form action={action} className="mt-4 grid sm:grid-cols-2 gap-3">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="tax_year" value={taxYear} />

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">Month</span>
        <select name="month" className="input" defaultValue={currentMonth}>
          {MONTH_LABELS.slice(0, currentMonth).map((m, i) => (
            <option key={i} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">Category</span>
        <select
          name="category_code"
          required
          className="input"
          value={categoryCode}
          onChange={(e) => setCategoryCode(e.target.value)}
        >
          <option value="" disabled>
            Select category
          </option>
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
              {c.is_meal ? " (50% deductible)" : ""}
              {c.is_typically_recurring ? " (recurring)" : ""}
            </option>
          ))}
        </select>
      </label>

      <div className="sm:col-span-2">
        <RecurrencePicker
          signal={categoryCode}
          signalSuggestsRecurring={recurringHint}
        />
      </div>

      <label className="grid gap-1.5 sm:col-span-2">
        <span className="text-sm font-medium text-forest-800">
          Amount (USD)
        </span>
        <input
          name="amount"
          type="text"
          inputMode="decimal"
          required
          placeholder="$0.00"
          className="input"
        />
      </label>

      <label className="grid gap-1.5 sm:col-span-2">
        <span className="text-sm font-medium text-forest-800">
          Notes (optional)
        </span>
        <input
          name="notes"
          type="text"
          className="input"
          placeholder="Adobe Creative Cloud subscription"
        />
      </label>

      <div className="sm:col-span-2">
        <button className="btn-primary w-full sm:w-auto">Add expense</button>
      </div>
    </form>
  );
}
