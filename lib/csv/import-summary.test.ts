import { describe, it, expect } from "vitest";
import {
  summarizeImport,
  summarizeImports,
  type ImportRowState,
} from "./import-summary";
import {
  LIVE_IMPORT_62,
  LIVE_IMPORT_62_INCOME_BOOKED,
  LIVE_IMPORT_ID,
} from "./fixtures/import-62-row";

const row = (over: Partial<ImportRowState> = {}): ImportRowState => ({
  appliedExpenseId: null,
  appliedIncomeId: null,
  ignored: false,
  ...over,
});

const applied = (n: number) =>
  Array.from({ length: n }, (_, i) => row({ appliedExpenseId: `exp${i}` }));
const ignored = (n: number) => Array.from({ length: n }, () => row({ ignored: true }));
const open = (n: number) => Array.from({ length: n }, () => row());

describe("summarizeImport", () => {
  it("reports complete when every row is applied", () => {
    const s = summarizeImport(applied(12));
    expect(s).toEqual({
      total: 12,
      applied: 12,
      income: 0,
      ignored: 0,
      unresolved: 0,
      isComplete: true,
    });
  });

  it("reports complete when every row is ignored", () => {
    const s = summarizeImport(ignored(5));
    expect(s.ignored).toBe(5);
    expect(s.unresolved).toBe(0);
    expect(s.isComplete).toBe(true);
  });

  it("counts a mixed import of applied, ignored and income", () => {
    const s = summarizeImport([
      ...applied(4),
      ...ignored(3),
      row({ appliedIncomeId: "inc1" }),
      row({ appliedIncomeId: "inc2" }),
    ]);
    expect(s).toEqual({
      total: 9,
      applied: 4,
      income: 2,
      ignored: 3,
      unresolved: 0,
      isComplete: true,
    });
  });

  it("is not complete with a single unresolved row among 61", () => {
    const s = summarizeImport([...applied(61), ...open(1)]);
    expect(s.total).toBe(62);
    expect(s.unresolved).toBe(1);
    expect(s.isComplete).toBe(false);
  });

  it("counts a row that is both applied and ignored once, as applied", () => {
    const s = summarizeImport([row({ appliedExpenseId: "exp1", ignored: true })]);
    expect(s.total).toBe(1);
    expect(s.applied).toBe(1);
    expect(s.ignored).toBe(0);
    // The bug this guards: three independent filters summed to 2 states
    // across 1 row and made a finished import look unfinished.
    expect(s.applied + s.income + s.ignored + s.unresolved).toBe(s.total);
  });

  it("counts a row that is both income and ignored once, as income", () => {
    const s = summarizeImport([row({ appliedIncomeId: "inc1", ignored: true })]);
    expect(s.income).toBe(1);
    expect(s.ignored).toBe(0);
  });

  it("prefers the expense link when a row carries both links", () => {
    const s = summarizeImport([
      row({ appliedExpenseId: "exp1", appliedIncomeId: "inc1" }),
    ]);
    expect(s.applied).toBe(1);
    expect(s.income).toBe(0);
  });

  it("treats an import with zero rows as not complete", () => {
    const s = summarizeImport([]);
    expect(s).toEqual({
      total: 0,
      applied: 0,
      income: 0,
      ignored: 0,
      unresolved: 0,
      isComplete: false,
    });
  });

  it("never throws on null or undefined", () => {
    expect(summarizeImport(null).total).toBe(0);
    expect(summarizeImport(undefined).isComplete).toBe(false);
  });
});

describe("summarizeImport on the live 62-row import", () => {
  it("derives 48 applied where the stored applied_count says 0", () => {
    // The regression this whole spec exists to close. bank_imports
    // .applied_count on this import reads 0; the rows say 48.
    const storedAppliedCount = 0;
    const s = summarizeImport(LIVE_IMPORT_62);
    expect(s.applied).toBe(48);
    expect(s.applied).not.toBe(storedAppliedCount);
  });

  it("matches the completion spec's photograph: 48 booked, 1 income, 13 unresolved", () => {
    const s = summarizeImport(LIVE_IMPORT_62_INCOME_BOOKED);
    expect(s).toEqual({
      total: 62,
      applied: 48,
      income: 1,
      ignored: 0,
      unresolved: 13,
      isComplete: false,
    });
  });

  it("counts 14 unresolved before the income row is booked", () => {
    const s = summarizeImport(LIVE_IMPORT_62);
    expect(s.total).toBe(62);
    expect(s.unresolved).toBe(14);
    expect(s.isComplete).toBe(false);
  });

  it("never reports complete while any row is unresolved", () => {
    expect(summarizeImport(LIVE_IMPORT_62).isComplete).toBe(false);
    expect(summarizeImport(LIVE_IMPORT_62_INCOME_BOOKED).isComplete).toBe(false);
  });
});

describe("summarizeImports", () => {
  it("groups by import id", () => {
    const out = summarizeImports([
      { importId: "a", ...row({ appliedExpenseId: "e1" }) },
      { importId: "a", ...row() },
      { importId: "b", ...row({ ignored: true }) },
    ]);
    expect(out.get("a")?.unresolved).toBe(1);
    expect(out.get("a")?.isComplete).toBe(false);
    expect(out.get("b")?.isComplete).toBe(true);
  });

  it("keys the live import's rows under its own id", () => {
    const out = summarizeImports(LIVE_IMPORT_62);
    expect(out.size).toBe(1);
    expect(out.get(LIVE_IMPORT_ID)?.applied).toBe(48);
  });

  it("omits imports it never saw a row for, and never throws", () => {
    expect(summarizeImports(null).size).toBe(0);
    expect(summarizeImports([]).get("nope")).toBeUndefined();
  });
});
