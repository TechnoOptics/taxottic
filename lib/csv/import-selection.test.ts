import { describe, it, expect } from "vitest";
import {
  describeBatchOutcome,
  isSelectable,
  partitionBatch,
  summarizeSelection,
  type SelectionRow,
} from "./import-selection";
import {
  LIVE_COMPANY_ID,
  LIVE_CONVENTION,
  LIVE_IMPORT_62,
  LIVE_IMPORT_ID,
} from "./fixtures/import-62-row";

const SCOPE = { importId: LIVE_IMPORT_ID, companyId: LIVE_COMPANY_ID };

const row = (over: Partial<SelectionRow> = {}): SelectionRow => ({
  id: "t1",
  importId: LIVE_IMPORT_ID,
  companyId: LIVE_COMPANY_ID,
  amountCents: 1000,
  suggestedCategoryCode: null,
  appliedCategoryCode: null,
  appliedExpenseId: null,
  appliedIncomeId: null,
  ignored: false,
  ...over,
});

describe("isSelectable", () => {
  it("offers a charge under charges_positive", () => {
    expect(isSelectable(row({ amountCents: 4065 }), "charges_positive")).toBe(true);
  });

  it("offers a charge under charges_negative", () => {
    expect(isSelectable(row({ amountCents: -4065 }), "charges_negative")).toBe(true);
  });

  it("never offers a refund under charges_positive", () => {
    // The live VERCEL -$0.84 credit.
    expect(isSelectable(row({ amountCents: -84 }), "charges_positive")).toBe(false);
  });

  it("never offers income under charges_negative", () => {
    expect(isSelectable(row({ amountCents: 400000 }), "charges_negative")).toBe(false);
  });

  it("never offers a row already booked as an expense", () => {
    expect(
      isSelectable(row({ appliedExpenseId: "exp1" }), "charges_positive"),
    ).toBe(false);
  });

  it("never offers a row already booked as income", () => {
    expect(
      isSelectable(row({ appliedIncomeId: "inc1" }), "charges_positive"),
    ).toBe(false);
  });

  it("never offers an ignored row", () => {
    expect(isSelectable(row({ ignored: true }), "charges_positive")).toBe(false);
  });

  it("never offers a zero-amount row under either convention", () => {
    expect(isSelectable(row({ amountCents: 0 }), "charges_positive")).toBe(false);
    expect(isSelectable(row({ amountCents: 0 }), "charges_negative")).toBe(false);
  });

  it("flips with the convention for the same amount", () => {
    const r = row({ amountCents: -2445 });
    expect(isSelectable(r, "charges_positive")).toBe(false); // a refund
    expect(isSelectable(r, "charges_negative")).toBe(true); // a charge
  });

  it("never throws on a missing row", () => {
    expect(isSelectable(null, "charges_positive")).toBe(false);
    expect(isSelectable(undefined, "charges_negative")).toBe(false);
  });
});

describe("summarizeSelection", () => {
  const rows = [
    row({ id: "a", amountCents: 1000 }),
    row({ id: "b", amountCents: 2000 }),
    row({ id: "refund", amountCents: -84 }),
    row({ id: "booked", amountCents: 3000, appliedExpenseId: "exp1" }),
  ];

  it("excludes refunds and booked rows from the select-all count", () => {
    const s = summarizeSelection(rows, [], "charges_positive");
    expect(s.selectable).toBe(2);
    expect(s.selectableIds).toEqual(["a", "b"]);
    expect(s.refunds).toBe(1);
    expect(s.alreadyBooked).toBe(1);
  });

  it("reports an empty selection as neither all nor indeterminate", () => {
    const s = summarizeSelection(rows, [], "charges_positive");
    expect(s.selected).toBe(0);
    expect(s.allSelected).toBe(false);
    expect(s.indeterminate).toBe(false);
  });

  it("reports the indeterminate state when some are selected", () => {
    const s = summarizeSelection(rows, ["a"], "charges_positive");
    expect(s.selected).toBe(1);
    expect(s.indeterminate).toBe(true);
    expect(s.allSelected).toBe(false);
  });

  it("reports allSelected only when every selectable row is chosen", () => {
    const s = summarizeSelection(rows, ["a", "b"], "charges_positive");
    expect(s.allSelected).toBe(true);
    expect(s.indeterminate).toBe(false);
  });

  it("does not count a selected id that is not selectable", () => {
    const s = summarizeSelection(rows, ["a", "refund", "booked"], "charges_positive");
    expect(s.selected).toBe(1);
    expect(s.selectedIds).toEqual(["a"]);
    // Selecting every id on the page must still not read as all selected,
    // because the refund was never in the model.
    expect(s.allSelected).toBe(false);
  });

  it("counts a booked refund in both independent counts", () => {
    const s = summarizeSelection(
      [row({ id: "lowes", amountCents: -2445, appliedExpenseId: "exp9" })],
      [],
      "charges_positive",
    );
    expect(s.refunds).toBe(1);
    expect(s.alreadyBooked).toBe(1);
    expect(s.selectable).toBe(0);
  });

  it("is empty and calm on no rows", () => {
    const s = summarizeSelection(null, null, "charges_positive");
    expect(s.selectable).toBe(0);
    expect(s.allSelected).toBe(false);
    expect(s.indeterminate).toBe(false);
  });
});

describe("partitionBatch", () => {
  const rows = [
    row({ id: "tagged", amountCents: 1000, appliedCategoryCode: "supplies" }),
    row({ id: "suggested", amountCents: 1100, suggestedCategoryCode: "software" }),
    row({ id: "bare", amountCents: 1200 }),
    row({ id: "refund", amountCents: -84, appliedCategoryCode: "supplies" }),
    row({
      id: "booked",
      amountCents: 1300,
      appliedCategoryCode: "supplies",
      appliedExpenseId: "exp1",
    }),
    row({ id: "skipped", amountCents: 1400, ignored: true }),
    row({
      id: "otherco",
      amountCents: 1500,
      companyId: "co_other",
      appliedCategoryCode: "supplies",
    }),
    row({
      id: "otherimport",
      amountCents: 1600,
      importId: "imp_other",
      appliedCategoryCode: "supplies",
    }),
  ];
  const plan = (ids: string[], intent: "apply" | "accept" | "ignore" = "apply") =>
    partitionBatch(rows, ids, "charges_positive", SCOPE, intent);
  const reasonFor = (ids: string[], id: string, intent?: "apply" | "accept" | "ignore") =>
    plan(ids, intent).skipped.find((s) => s.id === id)?.reason;

  it("acts on a valid tagged row", () => {
    const out = plan(["tagged"]);
    expect(out.actionable).toHaveLength(1);
    expect(out.actionable[0].row.id).toBe("tagged");
    expect(out.actionable[0].categoryCode).toBe("supplies");
    expect(out.skipped).toEqual([]);
  });

  it("skips a posted refund id instead of applying it", () => {
    const out = plan(["tagged", "refund"]);
    expect(out.actionable.map((a) => a.row.id)).toEqual(["tagged"]);
    expect(out.skipped).toEqual([{ id: "refund", reason: "refund" }]);
  });

  it("skips an already-booked id", () => {
    expect(reasonFor(["booked"], "booked")).toBe("already_booked");
  });

  it("skips an already-ignored id", () => {
    expect(reasonFor(["skipped"], "skipped")).toBe("ignored");
  });

  it("skips an id belonging to another company", () => {
    expect(reasonFor(["otherco"], "otherco")).toBe("foreign");
  });

  it("skips an id belonging to another import", () => {
    expect(reasonFor(["otherimport"], "otherimport")).toBe("foreign");
  });

  it("skips an id that is not in this import at all", () => {
    expect(reasonFor(["ghost"], "ghost")).toBe("unknown");
  });

  it("acts on a repeated id once and reports the repeat", () => {
    const out = plan(["tagged", "tagged", "tagged"]);
    expect(out.actionable).toHaveLength(1);
    expect(out.skipped).toEqual([
      { id: "tagged", reason: "duplicate" },
      { id: "tagged", reason: "duplicate" },
    ]);
  });

  it("keeps the good rows when a batch contains bad ones", () => {
    const out = plan(["tagged", "refund", "booked", "ghost", "otherco"]);
    expect(out.actionable).toHaveLength(1);
    expect(out.skipped).toHaveLength(4);
  });

  it("will not apply a row that carries only a Bella suggestion", () => {
    // Ruling 3: accepting a suggestion is its own action. Apply falling
    // back to suggested_category_code would silently erase whether a
    // human ever agreed with the software.
    expect(reasonFor(["suggested"], "suggested", "apply")).toBe("no_category");
  });

  it("accepts a Bella suggestion under the accept intent", () => {
    const out = plan(["suggested"], "accept");
    expect(out.actionable[0].categoryCode).toBe("software");
  });

  it("will not accept a row that has no suggestion", () => {
    expect(reasonFor(["bare"], "bare", "accept")).toBe("no_suggestion");
  });

  it("ignores a row with no category at all", () => {
    const out = plan(["bare"], "ignore");
    expect(out.actionable).toHaveLength(1);
    expect(out.actionable[0].categoryCode).toBeNull();
  });

  it("still refuses a refund under the ignore intent", () => {
    // Ignoring a refund is harmless, but a refund is not in the
    // selection model, so it cannot have been posted honestly.
    expect(reasonFor(["refund"], "refund", "ignore")).toBe("refund");
  });

  it("re-reads direction under the import's own convention", () => {
    const out = partitionBatch(rows, ["refund"], "charges_negative", SCOPE, "apply");
    // Under charges_negative that -$0.84 is a charge, not a refund.
    expect(out.actionable).toHaveLength(1);
  });

  it("never throws on empty or missing input", () => {
    expect(partitionBatch(null, null, "charges_positive", SCOPE, "apply")).toEqual({
      actionable: [],
      skipped: [],
    });
    expect(plan([]).actionable).toEqual([]);
  });

  it("agrees with isSelectable on every row, for both conventions", () => {
    for (const convention of ["charges_positive", "charges_negative"] as const) {
      for (const r of rows) {
        const inScope =
          r.importId === SCOPE.importId && r.companyId === SCOPE.companyId;
        const out = partitionBatch([r], [r.id], convention, SCOPE, "ignore");
        expect(out.actionable.length === 1).toBe(
          inScope && isSelectable(r, convention),
        );
      }
    }
  });
});

describe("the live 62-row import", () => {
  const summary = summarizeSelection(LIVE_IMPORT_62, [], LIVE_CONVENTION);

  it("offers 13 rows to select-all, not 62 and not 15", () => {
    expect(LIVE_IMPORT_62).toHaveLength(62);
    expect(summary.selectable).toBe(13);
    expect(summary.selectable).not.toBe(62);
    // 15 is what a filter that forgot refunds would offer: the 13 plus
    // the two negative rows.
    expect(summary.selectable).not.toBe(15);
  });

  it("counts both refunds and all 48 booked rows, and offers neither", () => {
    expect(summary.refunds).toBe(2);
    expect(summary.alreadyBooked).toBe(48);
    expect(summary.selectableIds).not.toContain("vercel_credit");
    expect(summary.selectableIds).not.toContain("lowes_refund");
  });

  it("holds neither refund selectable on its own", () => {
    const vercel = LIVE_IMPORT_62.find((r) => r.id === "vercel_credit")!;
    const lowes = LIVE_IMPORT_62.find((r) => r.id === "lowes_refund")!;
    expect(isSelectable(vercel, LIVE_CONVENTION)).toBe(false);
    expect(isSelectable(lowes, LIVE_CONVENTION)).toBe(false);
  });

  it("cannot reach either refund through select-all followed by Apply", () => {
    // The whole point of the spec. A user ticks the header checkbox and
    // presses Apply; nothing that reaches monthly_expenses may be a
    // refund, and the $24.45 Lowe's return must not be booked twice.
    const all = summarizeSelection(LIVE_IMPORT_62, [], LIVE_CONVENTION)
      .selectableIds;
    const out = partitionBatch(
      LIVE_IMPORT_62,
      all,
      LIVE_CONVENTION,
      { importId: LIVE_IMPORT_ID, companyId: LIVE_COMPANY_ID },
      "accept",
    );
    expect(out.actionable).toHaveLength(13);
    const ids = out.actionable.map((a) => a.row.id);
    expect(ids).not.toContain("vercel_credit");
    expect(ids).not.toContain("lowes_refund");
    for (const a of out.actionable) {
      expect(a.row.amountCents).toBeGreaterThan(0);
      expect(a.row.appliedExpenseId).toBeNull();
    }
  });

  it("drops a hand-posted refund id even when every other id is valid", () => {
    const forged = [
      ...summary.selectableIds,
      "vercel_credit",
      "lowes_refund",
    ];
    const out = partitionBatch(
      LIVE_IMPORT_62,
      forged,
      LIVE_CONVENTION,
      { importId: LIVE_IMPORT_ID, companyId: LIVE_COMPANY_ID },
      "accept",
    );
    expect(out.actionable).toHaveLength(13);
    expect(out.skipped).toEqual([
      { id: "vercel_credit", reason: "refund" },
      { id: "lowes_refund", reason: "already_booked" },
    ]);
  });
});

describe("describeBatchOutcome", () => {
  it("states plain counts", () => {
    expect(
      describeBatchOutcome({
        verb: "Applied",
        done: 39,
        skipped: [{ reason: "refund" }],
        failed: 0,
      }),
    ).toBe("Applied 39. Skipped 1 refund. 0 failed.");
  });

  it("names every skip reason it saw", () => {
    const msg = describeBatchOutcome({
      verb: "Applied",
      done: 2,
      skipped: [
        { reason: "refund" },
        { reason: "refund" },
        { reason: "already_booked" },
      ],
      failed: 1,
    });
    expect(msg).toBe("Applied 2. Skipped 2 refunds, 1 already booked. 1 failed.");
  });

  it("says nothing about skips when there were none", () => {
    expect(
      describeBatchOutcome({ verb: "Ignored", done: 5, skipped: [], failed: 0 }),
    ).toBe("Ignored 5. 0 failed.");
  });
});
