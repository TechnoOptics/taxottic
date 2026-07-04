"use client";

import { useId, useState } from "react";
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
  recentVendors = [],
  lastExpense = null,
  receiptThreshold = null,
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
  /** Manager receipt policy (item 10): the amount, in cents, ABOVE which a
   *  receipt is mandatory. null = no requirement. The manual form can't
   *  attach a receipt, so over-threshold amounts are blocked here and the
   *  user is pointed at the "Scan a receipt" flow above. */
  receiptThreshold?: number | null;
  /** Unique trimmed `notes` strings from recent expenses in this company,
   *  newest first. Threaded into a native <datalist> for vendor
   *  autocomplete (no extra JS, free keyboard support). Capped server-
   *  side to keep the HTML small. */
  recentVendors?: string[];
  /** Most recent expense for this company; the form exposes a
   *  "Repeat last" button that pre-fills category / amount / notes /
   *  recurrence from it so power users don't have to retype a vendor
   *  they just entered. The repeat sets the current month so the new
   *  row lands on today rather than the prior row's month. */
  lastExpense?: {
    categoryCode: string;
    amountCents: number;
    recurrence: string;
    notes: string;
  } | null;
}) {
  const [categoryCode, setCategoryCode] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const recurringHint =
    categories.find((c) => c.code === categoryCode)?.is_typically_recurring ??
    false;
  const vendorsListId = useId();

  // Live check against the manager's receipt threshold. Parse the same way
  // the server does (digits + one dot), so the client warning matches the
  // server's decision and we never let an over-threshold manual entry submit.
  const amountCents = (() => {
    const cleaned = amount.replace(/[^0-9.]/g, "");
    if (!cleaned) return null;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  })();
  const needsReceipt =
    receiptThreshold != null &&
    amountCents != null &&
    amountCents > receiptThreshold;
  const thresholdLabel =
    receiptThreshold != null
      ? `$${(receiptThreshold / 100).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : null;

  function repeatLast() {
    if (!lastExpense) return;
    setCategoryCode(lastExpense.categoryCode);
    setAmount((lastExpense.amountCents / 100).toFixed(2));
    setNotes(lastExpense.notes);
  }

  return (
    <form action={action} className="mt-4 grid sm:grid-cols-2 gap-3">
      {lastExpense ? (
        <div className="sm:col-span-2 -mb-1 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-ink-muted">
            Last entered:{" "}
            <span className="text-forest-800 font-medium">
              {lastExpense.notes
                ? `"${lastExpense.notes}"`
                : categories.find((c) => c.code === lastExpense.categoryCode)
                    ?.label ?? "previous expense"}
            </span>{" "}
            ·{" "}
            <span className="tabular-nums">
              ${(lastExpense.amountCents / 100).toFixed(2)}
            </span>
          </span>
          <button
            type="button"
            onClick={repeatLast}
            className="btn-ghost text-xs px-3 h-8"
          >
            Repeat last
          </button>
        </div>
      ) : null}
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
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {thresholdLabel && !needsReceipt ? (
          <span className="text-[11px] text-ink-muted">
            Receipts are required for expenses over {thresholdLabel}.
          </span>
        ) : null}
        {needsReceipt ? (
          <span
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800 leading-relaxed"
          >
            A receipt is required for expenses over {thresholdLabel}. Use{" "}
            <strong>Scan a receipt</strong> above to capture one, and it will
            file itself.
          </span>
        ) : null}
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
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          list={recentVendors.length > 0 ? vendorsListId : undefined}
          autoComplete="off"
        />
        {recentVendors.length > 0 ? (
          <datalist id={vendorsListId}>
            {recentVendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        ) : null}
      </label>

      <div className="sm:col-span-2">
        <button
          className="btn-primary w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={needsReceipt}
          title={
            needsReceipt
              ? `A receipt is required over ${thresholdLabel}`
              : undefined
          }
        >
          Add expense
        </button>
      </div>
    </form>
  );
}
