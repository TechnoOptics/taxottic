"use client";

import { useState } from "react";
import { PERSONAL_EXPENSE_CATEGORIES } from "@/lib/tax/personal-expense-categories";

/**
 * Add a personal (individual-side) deductible expense. Client component so we
 * can show the category hint as the user picks, and surface action errors
 * inline. Commits through the addPersonalExpense server action passed in.
 */
export function PersonalExpenseForm({
  action,
  defaultDate,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Today, as YYYY-MM-DD, computed on the server so SSR is stable. */
  defaultDate: string;
}) {
  const [category, setCategory] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hint = PERSONAL_EXPENSE_CATEGORIES.find((c) => c.code === category)?.hint;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await action(new FormData(e.currentTarget));
      e.currentTarget.reset();
      setCategory("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 grid sm:grid-cols-2 gap-3">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">Category</span>
        <select
          name="category"
          required
          className="input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="" disabled>
            Select category
          </option>
          {PERSONAL_EXPENSE_CATEGORIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">Amount (USD)</span>
        <input
          name="amount"
          type="text"
          inputMode="decimal"
          required
          placeholder="$0.00"
          className="input"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">Date incurred</span>
        <input
          name="incurred_on"
          type="date"
          required
          defaultValue={defaultDate}
          min={`${defaultDate.slice(0, 4)}-01-01`}
          max={defaultDate}
          className="input"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">Notes (optional)</span>
        <input
          name="notes"
          type="text"
          className="input"
          placeholder="e.g. Red Cross donation"
        />
      </label>

      {hint ? (
        <p className="sm:col-span-2 -mt-1 text-[11px] text-ink-muted">{hint}</p>
      ) : null}
      {error ? (
        <p className="sm:col-span-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={saving}
          className="btn-primary w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Add expense"}
        </button>
      </div>
    </form>
  );
}
