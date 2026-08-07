"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Selection on the import review screen.
 *
 * Client state only. Nothing is persisted, no column and no draft table.
 * A selected row is a row the user is about to act on, and that intent
 * lives for the length of one interaction. A `selected` column would
 * create a second source of truth about what the user meant, which is
 * exactly how bank_imports.applied_count came to read 0 while 48 rows
 * were booked.
 *
 * The selectable set is computed on the server by isSelectable and
 * handed down. Refunds, income and already-booked rows are absent from
 * it, so a select-all cannot reach them: the guarantee is structural,
 * not a disabled attribute one markup change away from being reachable.
 * The server re-derives the same set from the posted ids anyway, because
 * the client's selection is a request, not an authorization.
 *
 * See docs/superpowers/specs/2026-08-06-import-batch-selection-design.md.
 */

type BatchSelectionValue = {
  isSelectable: (id: string) => boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
};

const BatchSelectionContext = createContext<BatchSelectionValue | null>(null);

/** Null outside a provider, so TxRow renders exactly as it did before. */
export function useBatchSelection(): BatchSelectionValue | null {
  return useContext(BatchSelectionContext);
}

type Props = {
  importId: string;
  /** Every row a batch may honestly act on, decided server-side. */
  selectableIds: string[];
  applySelected: (formData: FormData) => Promise<void>;
  ignoreSelected: (formData: FormData) => Promise<void>;
  acceptSuggestions: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
};

export function BatchSelectionProvider({
  importId,
  selectableIds,
  applySelected,
  ignoreSelected,
  acceptSuggestions,
  children,
}: Props) {
  const selectable = useMemo(() => new Set(selectableIds), [selectableIds]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // A row that gets booked or ignored elsewhere on the page leaves the
  // selectable set on the next render, so the selection is intersected
  // with it here rather than stored already-filtered. Derived at render
  // means the bar can never count a row the batch would only skip, and
  // there is no second copy of the truth to fall out of date.
  const effective = useMemo(() => {
    const next = new Set<string>();
    for (const id of selected) if (selectable.has(id)) next.add(id);
    return next;
  }, [selected, selectable]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAll = useCallback(
    (on: boolean) => setSelected(on ? new Set(selectable) : new Set()),
    [selectable],
  );

  const value = useMemo<BatchSelectionValue>(
    () => ({
      isSelectable: (id) => selectable.has(id),
      isSelected: (id) => effective.has(id),
      toggle,
    }),
    [selectable, effective, toggle],
  );

  const count = effective.size;

  return (
    <BatchSelectionContext.Provider value={value}>
      <SelectAllHeader
        total={selectable.size}
        selected={count}
        onSetAll={setAll}
      />
      {children}
      {/* The bar renders only when something is selected. A bar of
          disabled buttons is noise. */}
      {count > 0 ? (
        <form className="sticky bottom-4 z-20 mt-6 card p-4 flex items-center justify-between gap-3 flex-wrap border-forest-300 shadow-lg">
          <input type="hidden" name="import_id" value={importId} />
          {Array.from(effective).map((id) => (
            <input key={id} type="hidden" name="tx_ids" value={id} />
          ))}
          <div className="text-sm text-forest-900">
            <span className="font-medium">{count}</span> selected of{" "}
            {selectable.size}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button formAction={acceptSuggestions} className="btn-ghost text-xs">
              Accept Bella&apos;s category ({count})
            </button>
            <button formAction={ignoreSelected} className="btn-ghost text-xs">
              Ignore ({count})
            </button>
            <button formAction={applySelected} className="btn-primary text-xs">
              Apply ({count})
            </button>
          </div>
        </form>
      ) : null}
    </BatchSelectionContext.Provider>
  );
}

/**
 * Tri-state header. "Select all" can only honestly mean all SELECTABLE
 * rows, since refunds and booked rows were never in the model.
 */
function SelectAllHeader({
  total,
  selected,
  onSetAll,
}: {
  total: number;
  selected: number;
  onSetAll: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const allSelected = total > 0 && selected === total;
  const indeterminate = selected > 0 && selected < total;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  if (total === 0) return null;

  return (
    <div className="mt-6 card px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
      <label className="flex items-center gap-2.5 text-sm text-forest-900 cursor-pointer select-none">
        {/* The checkbox stays a visually-unchanged 16px box; the tappable
            region is grown to the 44px minimum with an absolutely
            positioned overlay so it adds no width or height to the
            header bar. See RowCheckbox below for the same pattern and
            why it matters on the Fold5 cover screen (344px). */}
        <span className="relative inline-flex h-4 w-4 shrink-0">
          <span className="checkbox-hit-area absolute -inset-4" aria-hidden="true" />
          <input
            ref={ref}
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onSetAll(e.target.checked)}
            className="relative h-4 w-4 rounded border-forest-300 text-forest-800 focus:ring-forest-700"
          />
        </span>
        <span>Select all {total}</span>
      </label>
      <span className="text-[11px] text-ink-muted">
        {selected > 0 ? `${selected} selected` : "Refunds and booked rows are not selectable"}
      </span>
    </div>
  );
}

/**
 * The per-row checkbox. Renders nothing when the row is not selectable,
 * which is the point: a disabled checkbox on a refund invites "why can't
 * I tick this", and the honest answer belongs in the row rather than in
 * a tooltip on a dead control.
 */
export function RowCheckbox({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const ctx = useBatchSelection();
  if (!ctx || !ctx.isSelectable(id)) return null;
  return (
    // A <label> with no visible text: clicking anywhere inside it,
    // including the invisible overlay below, toggles the wrapped input.
    // The checkbox stays a visually-unchanged 16px box; the tappable
    // region is grown to the 44px minimum with an absolutely positioned
    // overlay so it adds no width to the row's flex layout. The Fold5
    // cover screen (344px) is the narrowest device this app ships to,
    // and a bare 16px checkbox in a dense row list is a genuinely hard
    // target there, on the primary control for the whole feature.
    <label className="relative mt-0.5 inline-flex h-4 w-4 shrink-0 cursor-pointer">
      <span className="checkbox-hit-area absolute -inset-4" aria-hidden="true" />
      <input
        type="checkbox"
        checked={ctx.isSelected(id)}
        onChange={() => ctx.toggle(id)}
        aria-label={`Select ${label}`}
        className="relative h-4 w-4 shrink-0 rounded border-forest-300 text-forest-800 focus:ring-forest-700"
      />
    </label>
  );
}
