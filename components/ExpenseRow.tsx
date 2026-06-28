"use client";

import { useState } from "react";
import { RecurrencePicker, type Cadence } from "./RecurrencePicker";
import { formatCents } from "@/lib/tax/forecast";

// Round-5 audit Medium: expense rows had Remove but no Edit. Same
// rationale as IncomeRow — power users entering 30+ transactions per
// session hit typos, and "delete + re-add" loses recurrence + notes
// and risks double-counting. ExpenseRow holds view + inline edit in
// one component. Delete is wrapped with a confirm() so a mis-click
// can't destroy tax-relevant data.

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function prettyCadence(r: string): string {
  return (
    {
      weekly: "Weekly",
      monthly: "Monthly",
      quarterly: "Quarterly",
      annual: "Annual",
    }[r] ?? r
  );
}

function shortCadence(r: string): string {
  return (
    {
      weekly: "wk",
      monthly: "mo",
      quarterly: "qtr",
      annual: "yr",
    }[r] ?? r
  );
}

export type ExpenseRowProps = {
  row: {
    id: string;
    month: number;
    amount_cents: number;
    category_code: string;
    recurrence: string;
    notes: string | null;
    category?: { label: string; is_meal: boolean } | null;
  };
  companyId: string;
  taxYear: number;
  currentMonth: number;
  categories: {
    code: string;
    label: string;
    is_meal: boolean;
    is_typically_recurring: boolean;
  }[];
  // Who entered this expense (monthly_expenses.user_id → display name).
  // Only set by the parent when the company has multiple members and the
  // list isn't already filtered to a single person, so a solo operator
  // never sees a redundant "added by me" tag.
  addedByLabel?: string | null;
  updateAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

export function ExpenseRow({
  row,
  companyId,
  taxYear,
  currentMonth,
  categories,
  addedByLabel,
  updateAction,
  deleteAction,
}: ExpenseRowProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-lg border border-gold-300 bg-cream/50 px-4 py-3">
        <form
          action={updateAction}
          onSubmit={() => setEditing(false)}
          className="grid sm:grid-cols-2 gap-3"
        >
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="company_id" value={companyId} />
          <input type="hidden" name="tax_year" value={taxYear} />
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">Month</span>
            <select
              name="month"
              className="input"
              defaultValue={row.month}
            >
              {MONTH_LABELS.slice(0, currentMonth).map((m, i) => (
                <option key={i} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Category
            </span>
            <select
              name="category_code"
              required
              className="input"
              defaultValue={row.category_code}
            >
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                  {c.is_meal ? " (50% deductible)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <RecurrencePicker defaultValue={row.recurrence as Cadence} />
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
              className="input"
              defaultValue={(row.amount_cents / 100).toFixed(2)}
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
              defaultValue={row.notes ?? ""}
            />
          </label>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button type="submit" className="btn-primary text-xs px-3 h-9">
              Save changes
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="btn-ghost text-xs px-3 h-9"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm gap-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-forest-900">
          {MONTH_LABELS[row.month - 1]} -{" "}
          {row.category?.label ?? row.category_code}
          {row.category?.is_meal ? (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-gold-700">
              50%
            </span>
          ) : null}
          {row.recurrence && row.recurrence !== "one_off" ? (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-gold-700 border border-gold-300/60 rounded px-1.5 py-0.5">
              {prettyCadence(row.recurrence)}
            </span>
          ) : null}
        </div>
        {row.notes ? (
          <div className="text-xs text-ink-muted truncate">{row.notes}</div>
        ) : null}
        {addedByLabel ? (
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-forest-700">
            <svg
              viewBox="0 0 16 16"
              width="11"
              height="11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="8" cy="5" r="3" />
              <path strokeLinecap="round" d="M2.5 14c0-3 2.5-4.5 5.5-4.5S13.5 11 13.5 14" />
            </svg>
            {addedByLabel}
          </div>
        ) : null}
      </div>
      <div className="text-forest-900 font-medium tabular-nums">
        {formatCents(row.amount_cents, { showCents: true })}
        {row.recurrence && row.recurrence !== "one_off" ? (
          <span className="ml-1 text-[10px] text-ink-muted">
            / {shortCadence(row.recurrence)}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit expense entry"
          className="text-xs text-ink-muted hover:text-forest-900 px-2 py-1"
        >
          Edit
        </button>
        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                "Remove this expense entry? This cannot be undone.",
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="company_id" value={companyId} />
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            className="text-xs text-ink-muted hover:text-red-700 px-2 py-1"
          >
            Remove
          </button>
        </form>
      </div>
    </li>
  );
}
