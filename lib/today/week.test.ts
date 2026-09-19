import { describe, expect, it } from "vitest";
import { weekLedger } from "./week";

describe("this week's ledger", () => {
  const asOf = new Date("2026-09-05T12:00:00Z");
  it("merges expenses, business drives and applied transactions from the last seven days, newest first, signed", () => {
    const rows = weekLedger({
      expenses: [{ createdAt: "2026-09-03T10:00:00Z", amountCents: 2200, label: "Adobe Creative Cloud" }],
      trips: [
        { endedAt: "2026-09-04T18:00:00Z", miles: 22.7, deductionCents: 1646, classification: "business" },
        { endedAt: "2026-09-04T19:00:00Z", miles: 5, deductionCents: 362, classification: "personal" },
      ],
      applied: [{ appliedAt: "2026-09-02T09:00:00Z", amountCents: 41000, label: "Invoice paid, Northwind Co." }],
      asOf,
    });
    expect(rows.map((r) => r.text)).toEqual(["Drive, 22.7 mi", "Adobe Creative Cloud", "Invoice paid, Northwind Co."]);
    expect(rows.map((r) => r.amount)).toEqual(["-$16", "-$22", "+$410"]);
    expect(rows.map((r) => r.date)).toEqual(["Sep 4", "Sep 3", "Sep 2"]);
  });
  it("drops anything older than seven days and caps the rows", () => {
    const rows = weekLedger({
      expenses: Array.from({ length: 10 }, (_, i) => ({ createdAt: `2026-09-0${(i % 5) + 1}T10:00:00Z`, amountCents: 100 * (i + 1), label: `e${i}` })).concat([{ createdAt: "2026-08-20T10:00:00Z", amountCents: 999, label: "old" }]),
      trips: [],
      applied: [],
      asOf,
      maxRows: 7,
    });
    expect(rows).toHaveLength(7);
    expect(rows.some((r) => r.text === "old")).toBe(false);
  });
  it("an expense of 40 cents rounds to zero and renders with no sign", () => {
    const rows = weekLedger({
      expenses: [{ createdAt: "2026-09-03T10:00:00Z", amountCents: 40, label: "Coffee" }],
      trips: [],
      applied: [],
      asOf,
    });
    expect(rows[0].amount).toBe("$0");
  });
  /**
   * The page's read is `.eq("user_action", "applied").is("applied_to_expense_id", null)`,
   * so a dismissed row and a row already written through to monthly_expenses
   * never reach the ledger: the first was never money that moved, the second
   * is already in the ledger as an expense. This mirrors that filter and the
   * mapping beside it so the shape the ledger is fed is pinned somewhere.
   */
  type BankRow = { applied_at: string; amount_cents: number; merchant_name: string | null; user_action: string; applied_to_expense_id: string | null };
  const asPageWouldMap = (rows: BankRow[]) =>
    rows
      .filter((r) => r.user_action === "applied" && r.applied_to_expense_id === null)
      .map((r) => ({ appliedAt: r.applied_at, amountCents: -Number(r.amount_cents ?? 0), label: r.merchant_name ?? "Transaction" }));

  it("a dismissed row never reaches the ledger, and neither does one already written to an expense", () => {
    const rows = weekLedger({
      expenses: [],
      trips: [],
      applied: asPageWouldMap([
        { applied_at: "2026-09-03T10:00:00Z", amount_cents: -41000, merchant_name: "Invoice paid, Northwind Co.", user_action: "applied", applied_to_expense_id: null },
        { applied_at: "2026-09-03T11:00:00Z", amount_cents: 2400, merchant_name: "Not ours", user_action: "dismissed", applied_to_expense_id: null },
        { applied_at: "2026-09-03T12:00:00Z", amount_cents: 2200, merchant_name: "Adobe, already an expense", user_action: "applied", applied_to_expense_id: "e1" },
      ]),
      asOf,
    });
    expect(rows.map((r) => r.text)).toEqual(["Invoice paid, Northwind Co."]);
  });

  it("a negative bank amount is money in, and renders with a plus", () => {
    const rows = weekLedger({
      expenses: [],
      trips: [],
      applied: asPageWouldMap([
        { applied_at: "2026-09-03T10:00:00Z", amount_cents: -41000, merchant_name: "Invoice paid, Northwind Co.", user_action: "applied", applied_to_expense_id: null },
      ]),
      asOf,
    });
    expect(rows[0].amount).toBe("+$410");
  });

  it("an applied amount of zero renders with no sign", () => {
    const rows = weekLedger({
      expenses: [],
      trips: [],
      applied: [{ appliedAt: "2026-09-03T10:00:00Z", amountCents: 0, label: "Void" }],
      asOf,
    });
    expect(rows[0].amount).toBe("$0");
  });
});
