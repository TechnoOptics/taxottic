import { describe, it, expect } from "vitest";
import { fetchAllPages, PAGE_SIZE } from "./paginate";
import { summarizeImport, type ImportRowState } from "@/lib/csv/import-summary";

/**
 * A stand-in for PostgREST's paging behaviour, including the part that
 * causes the bug: it never says "there is more", it just hands back a
 * full page.
 */
function fakeTable<T>(rows: T[]) {
  const calls: [number, number][] = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({
      data: rows.slice(from, Math.min(to + 1, from + PAGE_SIZE)),
      error: null,
    });
  };
  return { page, calls };
}

describe("fetchAllPages", () => {
  it("returns everything when there is less than one page", async () => {
    const t = fakeTable(Array.from({ length: 7 }, (_, i) => i));
    expect(await fetchAllPages(t.page)).toHaveLength(7);
    expect(t.calls).toHaveLength(1);
  });

  it("returns everything across a page boundary", async () => {
    const t = fakeTable(Array.from({ length: 1200 }, (_, i) => i));
    const out = await fetchAllPages(t.page);
    expect(out).toHaveLength(1200);
    // Not silently truncated at max-rows, which is the whole point.
    expect(out).not.toHaveLength(PAGE_SIZE);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("preserves order across pages", async () => {
    const t = fakeTable(Array.from({ length: 2500 }, (_, i) => i));
    const out = await fetchAllPages(t.page);
    expect(out[0]).toBe(0);
    expect(out[999]).toBe(999);
    expect(out[1000]).toBe(1000);
    expect(out[2499]).toBe(2499);
  });

  it("costs one extra empty request on an exactly-full last page", async () => {
    const t = fakeTable(Array.from({ length: PAGE_SIZE }, (_, i) => i));
    expect(await fetchAllPages(t.page)).toHaveLength(PAGE_SIZE);
    expect(t.calls).toHaveLength(2);
  });

  it("handles no rows at all", async () => {
    const t = fakeTable([]);
    expect(await fetchAllPages(t.page)).toEqual([]);
  });

  it("treats a null data page as the end", async () => {
    const out = await fetchAllPages(() =>
      Promise.resolve({ data: null, error: null }),
    );
    expect(out).toEqual([]);
  });

  it("throws rather than returning a partial read", async () => {
    // Returning what it had would recreate the silent truncation this
    // function exists to prevent.
    await expect(
      fetchAllPages(() =>
        Promise.resolve({ data: null, error: { message: "boom" } }),
      ),
    ).rejects.toThrow(/boom/);
  });

  it("stops at a hard page cap rather than spinning forever", async () => {
    let calls = 0;
    const out = await fetchAllPages(() => {
      calls++;
      return Promise.resolve({
        data: Array.from({ length: PAGE_SIZE }, () => 1),
        error: null,
      });
    });
    expect(calls).toBeLessThanOrEqual(200);
    expect(out.length).toBeLessThanOrEqual(200 * PAGE_SIZE);
  });
});

describe("a 1200-row import summarizes correctly", () => {
  // The regression. Before pagination, a read of this import came back
  // truncated at 1000 rows and summarizeImport counted only those.
  const rows: ImportRowState[] = [
    ...Array.from({ length: 1150 }, (_, i) => ({
      appliedExpenseId: `exp${i}`,
      appliedIncomeId: null,
      ignored: false,
    })),
    ...Array.from({ length: 50 }, () => ({
      appliedExpenseId: null,
      appliedIncomeId: null,
      ignored: false,
    })),
  ];

  it("counts all 1200 rows, not the first 1000", async () => {
    const t = fakeTable(rows);
    const all = await fetchAllPages(t.page);
    const s = summarizeImport(all);
    expect(s.total).toBe(1200);
    expect(s.applied).toBe(1150);
    expect(s.unresolved).toBe(50);
  });

  it("refuses to call a 1200-row import complete on a truncated read", async () => {
    // The correctness hole, stated as a test. The first 1000 rows of
    // this import are all applied, so a truncated read reports
    // isComplete true and completeImport's guard passes while 50 rows
    // are still unresolved.
    const truncated = summarizeImport(rows.slice(0, PAGE_SIZE));
    expect(truncated.isComplete).toBe(true);

    const t = fakeTable(rows);
    const full = summarizeImport(await fetchAllPages(t.page));
    expect(full.isComplete).toBe(false);
    expect(full.unresolved).toBe(50);
  });
});
