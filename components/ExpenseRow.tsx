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
    classification?: "business" | "personal";
    managerNote?: string | null;
    recurrenceEndMonth?: number | null;
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
  // Manager-only review controls — reclassify to/from personal, leave a
  // note, and stop/resume a recurring charge's forward projection. Only
  // passed by the parent when the viewer is a manager; the note itself
  // still renders for everyone (the point is the teammate sees it).
  isManager?: boolean;
  reclassifyAction?: (formData: FormData) => Promise<void>;
  setNoteAction?: (formData: FormData) => Promise<void>;
  setRecurrenceEndAction?: (formData: FormData) => Promise<void>;
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
  isManager = false,
  reclassifyAction,
  setNoteAction,
  setRecurrenceEndAction,
}: ExpenseRowProps) {
  const [editing, setEditing] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const isPersonal = row.classification === "personal";
  const isRecurring = !!row.recurrence && row.recurrence !== "one_off";
  const recurrenceStopped = row.recurrenceEndMonth != null;

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
    <li
      className={
        "rounded-lg border px-4 py-3 text-sm " +
        (isPersonal
          ? "border-ink-muted/20 bg-cream/30 opacity-70"
          : "border-forest-100 bg-white/70")
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-forest-900">
            {MONTH_LABELS[row.month - 1]} -{" "}
            {row.category?.label ?? row.category_code}
            {row.category?.is_meal ? (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-gold-700">
                50%
              </span>
            ) : null}
            {isRecurring ? (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-gold-700 border border-gold-300/60 rounded px-1.5 py-0.5">
                {prettyCadence(row.recurrence)}
                {recurrenceStopped ? " · stopped" : ""}
              </span>
            ) : null}
            {isPersonal ? (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-muted border border-ink-muted/30 rounded px-1.5 py-0.5">
                Personal · excluded
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
          {row.managerNote ? (
            <div className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200/70 rounded px-2 py-1">
              <span aria-hidden="true">💬</span>
              <span className="italic">{row.managerNote}</span>
            </div>
          ) : null}
        </div>
        <div className="text-forest-900 font-medium tabular-nums shrink-0">
          {formatCents(row.amount_cents, { showCents: true })}
          {isRecurring ? (
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
      </div>

      {/* Manager review controls — reclassify, note, stop/resume a
          recurring charge. Hidden from non-managers entirely (a member
          still just SEES the note above, if one exists). */}
      {isManager ? (
        <div className="mt-2 pt-2 border-t border-dashed border-forest-100 flex flex-wrap items-center gap-2">
          {reclassifyAction ? (
            <form action={reclassifyAction}>
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="id" value={row.id} />
              <input
                type="hidden"
                name="classification"
                value={isPersonal ? "business" : "personal"}
              />
              <button
                type="submit"
                className="text-[11px] text-ink-muted hover:text-forest-900 underline decoration-dotted"
              >
                {isPersonal ? "Mark business" : "Move to personal"}
              </button>
            </form>
          ) : null}
          {setRecurrenceEndAction && isRecurring ? (
            <form action={setRecurrenceEndAction}>
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="id" value={row.id} />
              <input
                type="hidden"
                name="clear"
                value={recurrenceStopped ? "1" : "0"}
              />
              <button
                type="submit"
                className="text-[11px] text-ink-muted hover:text-forest-900 underline decoration-dotted"
              >
                {recurrenceStopped ? "Resume recurring" : "Stop recurring"}
              </button>
            </form>
          ) : null}
          {setNoteAction ? (
            editingNote ? (
              <form
                action={setNoteAction}
                onSubmit={() => setEditingNote(false)}
                className="flex items-center gap-1.5 flex-1 min-w-[200px]"
              >
                <input type="hidden" name="company_id" value={companyId} />
                <input type="hidden" name="id" value={row.id} />
                <input
                  name="manager_note"
                  type="text"
                  defaultValue={row.managerNote ?? ""}
                  placeholder="Note visible to this teammate…"
                  className="input text-xs h-7 flex-1"
                  autoFocus
                />
                <button
                  type="submit"
                  className="text-[11px] text-forest-900 font-medium px-1.5"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingNote(false)}
                  className="text-[11px] text-ink-muted px-1"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setEditingNote(true)}
                className="text-[11px] text-ink-muted hover:text-forest-900 underline decoration-dotted"
              >
                {row.managerNote ? "Edit note" : "Add a note"}
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
