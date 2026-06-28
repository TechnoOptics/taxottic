"use client";

import { useState } from "react";
import { RecurrencePicker, type Cadence } from "./RecurrencePicker";
import { formatCents } from "@/lib/tax/forecast";

// Round-5 audit Medium findings:
//   1. Income rows had Remove but no Edit. To fix a typo, a user had
//      to delete + re-add — losing recurrence / source / notes and
//      risking double-counting in the in-between window.
//   2. Remove had no confirmation. A single mis-click destroys
//      tax-relevant data.
//
// IncomeRow holds the row in either view or edit mode. The edit form
// uses the new updateIncome server action; cancelling reverts to
// view mode without server churn. The delete form is wrapped with an
// onSubmit confirm() so a single mis-click can't destroy the row.

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

function prettySource(s: string): string {
  return INCOME_SOURCES.find((x) => x.value === s)?.label ?? s;
}

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

export type IncomeRowProps = {
  row: {
    id: string;
    month: number;
    amount_cents: number;
    source: string;
    recurrence: string;
    notes: string | null;
  };
  companyId: string;
  taxYear: number;
  currentMonth: number;
  updateAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

export function IncomeRow({
  row,
  companyId,
  taxYear,
  currentMonth,
  updateAction,
  deleteAction,
}: IncomeRowProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-lg border border-gold-300 bg-cream/50 px-4 py-3">
        <form
          action={updateAction}
          onSubmit={() => {
            // Optimistic close: the server-action re-render will
            // produce a fresh row anyway. Keeps the edit form from
            // briefly showing the stale data while React reconciles.
            setEditing(false);
          }}
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
            <span className="text-sm font-medium text-forest-800">Source</span>
            <select
              name="source"
              className="input"
              defaultValue={row.source}
            >
              {INCOME_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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
          {MONTH_LABELS[row.month - 1]} - {prettySource(row.source)}
          {row.recurrence && row.recurrence !== "one_off" ? (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-gold-700 border border-gold-300/60 rounded px-1.5 py-0.5">
              {prettyCadence(row.recurrence)}
            </span>
          ) : null}
        </div>
        {row.notes ? (
          <div className="text-xs text-ink-muted truncate">{row.notes}</div>
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
          aria-label="Edit income entry"
          className="text-xs text-ink-muted hover:text-forest-900 px-2 py-1"
        >
          Edit
        </button>
        <form
          action={deleteAction}
          onSubmit={(e) => {
            // Round-5 audit Low: single-click destructive action is a
            // foot-gun for tax-relevant data. Confirm before the
            // server action runs.
            if (
              !window.confirm(
                "Remove this income entry? This cannot be undone.",
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
