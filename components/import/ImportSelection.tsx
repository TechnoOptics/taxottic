"use client";

import { memo, useCallback, useMemo, useState, useTransition } from "react";
import { TxRow } from "@/components/import/TxRow";
import type { CategoryOption } from "@/components/CategoryCombobox";
import { formatCents } from "@/lib/tax/forecast";
import {
  rowEligibility,
  defaultSelectedIds,
  selectableIds,
  summarize,
  type SelectableRow,
  type SelectionContext,
} from "@/lib/csv/selection";

/**
 * Checkbox selection over an import's expense candidates.
 *
 * The screen already had a per-row category picker and a single "apply
 * everything that has a category" button. What it had no way to express was
 * "this one is not a business expense" without first un-categorizing the row.
 * That is what the checkboxes add: the user's ticks are the instruction, and
 * one button saves exactly those.
 *
 * Defaults come from lib/csv/selection and are deliberately asymmetric: a
 * category a person chose is pre-ticked, a category the model guessed is not.
 * The reasoning is in that file. "Select all" is the escape hatch and does
 * reach the guesses, because by then the user has asked for them.
 *
 * Performance: rows are memoized on their ticked flag, so toggling one
 * checkbox re-renders one row rather than the whole list. `content-visibility:
 * auto` is deliberately NOT used here; it measured about three times worse on
 * this codebase because the row heights vary a lot (a row with a Bella chip
 * and a citation line is much taller than a bare one), so the browser
 * re-estimates constantly while scrolling.
 */

type CatInfo = {
  label: string;
  scope: string;
  schedule_c_line: string | null;
  irc_section: string | null;
  irs_pub: string | null;
  irs_url: string | null;
};

type Tx = SelectableRow & { raw_category: string | null };

export type MonthGroup = {
  key: string;
  label: string;
  rows: Tx[];
  totalCents: number;
};

type SaveResult = {
  saved: number;
  savedCents: number;
  labelledNotBooked: number;
  skipped: number;
};

type Props = {
  groups: MonthGroup[];
  taggedRows: Tx[];
  taggedOpen: boolean;
  importId: string;
  companyId: string;
  cats: CategoryOption[];
  frequentCodes: string[];
  catById: Map<string, CatInfo>;
  isCredit: boolean;
  ctx: SelectionContext;
  highlightId?: string;
  setTxCategory: (formData: FormData) => Promise<void>;
  ignoreTx: (formData: FormData) => Promise<void>;
  teachBella: (formData: FormData) => Promise<void>;
  saveSelected: (formData: FormData) => Promise<SaveResult>;
};

const MemoRow = memo(TxRow);

export function ImportSelection({
  groups,
  taggedRows,
  taggedOpen,
  importId,
  companyId,
  cats,
  frequentCodes,
  catById,
  isCredit,
  ctx,
  highlightId,
  setTxCategory,
  ignoreTx,
  teachBella,
  saveSelected,
}: Props) {
  // Every row that carries a checkbox, in display order.
  const allRows = useMemo(
    () => [...groups.flatMap((g) => g.rows), ...taggedRows],
    [groups, taggedRows],
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultSelectedIds(allRows, ctx)),
  );
  const [result, setResult] = useState<SaveResult | null>(null);
  const [isSaving, startSaving] = useTransition();

  const eligibleIds = useMemo(() => selectableIds(allRows, ctx), [allRows, ctx]);
  const { count, totalCents } = useMemo(
    () => summarize(allRows, selected, ctx),
    [allRows, selected, ctx],
  );

  const toggle = useCallback((id: string, next: boolean) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }, []);

  const allSelected =
    eligibleIds.length > 0 && count === eligibleIds.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(eligibleIds));
  }

  function onSave() {
    const fd = new FormData();
    fd.set("import_id", importId);
    fd.set("company_id", companyId);
    for (const id of selected) fd.append("tx_ids", id);
    startSaving(async () => {
      const r = await saveSelected(fd);
      setResult(r);
      setSelected(new Set());
    });
  }

  const rowProps = {
    importId,
    companyId,
    cats,
    frequentCodes,
    catById,
    isCredit,
    setTxCategory,
    ignoreTx,
    teachBella,
  };

  return (
    <>
      {/* Select-all bar. Sits above the list so the bulk control is found
          before the user starts working down the rows. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge bg-surface-2/40 px-3 py-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={eligibleIds.length === 0}
            className="h-5 w-5 cursor-pointer accent-[var(--accent-2)] disabled:opacity-40"
          />
          <span className="text-sm font-medium text-foreground">
            {allSelected ? "Clear all" : "Select all"}
          </span>
          <span className="text-xs text-muted">
            {eligibleIds.length} can be saved
          </span>
        </label>
        <span className="text-xs text-muted">
          {count} selected
        </span>
      </div>

      {result ? (
        <div
          role="status"
          className="mt-3 rounded-lg border border-edge bg-surface-2/60 px-3 py-2 text-sm text-foreground"
        >
          Saved {result.saved}{" "}
          {result.saved === 1 ? "expense" : "expenses"}
          {result.savedCents > 0 ? ` totalling ${formatCents(result.savedCents)}` : ""}.
          {result.labelledNotBooked > 0
            ? ` ${result.labelledNotBooked} labelled but not deductible, so not booked.`
            : ""}
          {result.skipped > 0
            ? ` ${result.skipped} could not be saved and are still listed.`
            : ""}
        </div>
      ) : null}

      <div className="mt-4 grid gap-6">
        {groups.map((g) => (
          <div key={g.key}>
            <h3 className="flex items-baseline gap-2 text-[11px] uppercase tracking-[0.22em] text-gold-700">
              <span>{g.label}</span>
              <span className="normal-case tracking-normal text-ink-muted">
                {g.rows.length} {g.rows.length === 1 ? "row" : "rows"} ·{" "}
                {formatCents(g.totalCents)}
              </span>
            </h3>
            <ul className="mt-2 grid gap-2">
              {g.rows.map((t) => (
                <MemoRow
                  key={t.id}
                  tx={t}
                  {...rowProps}
                  eligibility={rowEligibility(t, ctx)}
                  selected={selected.has(t.id)}
                  onToggleSelected={toggle}
                  highlight={t.id === highlightId}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {taggedRows.length > 0 ? (
        <details className="mt-6" open={taggedOpen}>
          <summary className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 text-sm">
            <span className="font-medium text-foreground">
              {taggedRows.length} already sorted
            </span>
            <span className="text-xs text-muted">
              Review or change picks
            </span>
          </summary>
          <ul className="mt-3 grid gap-2">
            {taggedRows.map((t) => (
              <MemoRow
                key={t.id}
                tx={t}
                {...rowProps}
                eligibility={rowEligibility(t, ctx)}
                selected={selected.has(t.id)}
                onToggleSelected={toggle}
                highlight={t.id === highlightId}
              />
            ))}
          </ul>
        </details>
      ) : null}

      {/* Sticky confirm bar. The exact count and the exact dollar total are
          on the button itself, because this click is what puts numbers on a
          tax return and "Save" alone does not say how much. */}
      <div
        className="sticky bottom-0 z-20 mt-6 border-t border-edge bg-surface/95 px-3 py-3 backdrop-blur-xl"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <div className="font-medium text-foreground">
              {count} {count === 1 ? "row" : "rows"} selected
            </div>
            <div className="text-xs text-muted">
              {formatCents(totalCents)} will be added to your deductions
            </div>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={count === 0 || isSaving}
            className="btn-primary w-full sm:w-auto"
          >
            {isSaving
              ? "Saving…"
              : `Save ${count} as business ${count === 1 ? "expense" : "expenses"}`}
          </button>
        </div>
      </div>
    </>
  );
}
