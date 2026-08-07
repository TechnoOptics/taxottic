"use client";

import { BatchSelectionProvider } from "./BatchSelection";
import { TxRow } from "./TxRow";
import { summarizeSelection, type SelectionRow } from "@/lib/csv/import-selection";
import type { SignConvention } from "@/lib/csv/sign-convention";
import type { CategoryOption } from "@/components/CategoryCombobox";

/**
 * Test-only wrapper around the real batch-selection composition
 * (BatchSelectionProvider + TxRow, inside a "mt-2 grid gap-2" <ul>) exactly
 * as app/c/[publicId]/import/[importId]/page.tsx assembles it.
 *
 * Nothing in the app imports this. Two things a component test cannot pass
 * straight across the Playwright CT browser boundary:
 *
 *   1. TxRow takes `catById: Map<string, CatInfo>`. A Map does not survive
 *      prop serialization (it arrives as a plain object and `.get` is not a
 *      function), so this harness takes the same data as entries and
 *      rebuilds the Map on the browser side. Same fix the now-superseded
 *      PR #489 used for its ImportSelectionHarness.
 *   2. `selectableIds` is derived server-side on the real page by
 *      summarizeSelection over the loaded rows. The harness re-derives it
 *      from that same pure function rather than a hand-picked fixture, so
 *      the selection model under test is the real one.
 */

type Tx = React.ComponentProps<typeof TxRow>["tx"];
type CatInfo = NonNullable<
  React.ComponentProps<typeof TxRow>["catById"] extends Map<string, infer V>
    ? V
    : never
>;

type Props = {
  importId: string;
  companyId: string;
  cats: CategoryOption[];
  frequentCodes: string[];
  catEntries: [string, CatInfo][];
  convention: SignConvention;
  /** Rows as loaded from bank_import_transactions, same shape page.tsx maps into both `tx` and the selection model. */
  rows: (Tx & { applied_income_id?: string | null })[];
};

function noop() {
  return Promise.resolve();
}

export function TxRowGroupHarness({
  importId,
  companyId,
  cats,
  frequentCodes,
  catEntries,
  convention,
  rows,
}: Props) {
  const catById = new Map(catEntries);

  const selectionRows: SelectionRow[] = rows.map((t) => ({
    id: t.id,
    importId,
    companyId,
    amountCents: t.amount_cents,
    suggestedCategoryCode: t.suggested_category_code,
    appliedCategoryCode: t.applied_category_code,
    appliedExpenseId: t.applied_expense_id,
    appliedIncomeId: t.applied_income_id ?? null,
    ignored: t.ignored,
  }));
  const { selectableIds } = summarizeSelection(selectionRows, [], convention);

  return (
    <BatchSelectionProvider
      importId={importId}
      selectableIds={selectableIds}
      applySelected={noop}
      ignoreSelected={noop}
      acceptSuggestions={noop}
    >
      <ul className="mt-2 grid gap-2">
        {rows.map((t) => (
          <TxRow
            key={t.id}
            tx={t}
            importId={importId}
            companyId={companyId}
            cats={cats}
            frequentCodes={frequentCodes}
            catById={catById}
            convention={convention}
            setTxCategory={noop}
            ignoreTx={noop}
            teachBella={noop}
            moveBookedTransaction={noop}
          />
        ))}
      </ul>
    </BatchSelectionProvider>
  );
}
