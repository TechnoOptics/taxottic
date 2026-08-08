import { describe, it, expect } from "vitest";
import { sniffColumns, parseCsv, parseAmountCents } from "./parse";

// The description column is not cosmetic on this surface. It feeds
// autoCategorize, it is what Bella reads to pick a Schedule C code, and
// it is one third of chargeFingerprint, the identity the exact-charge
// dedupe drops rows on. Point it at the wrong column and a whole
// statement categorizes off a date string while two unrelated charges of
// the same amount on the same day become "the same charge".

describe("sniffColumns", () => {
  it("finds Description on a Chase credit-card export", () => {
    // Verbatim Chase credit-card header. "Transaction Date" comes first
    // and contains the "transaction" needle.
    const cols = sniffColumns([
      "Transaction Date",
      "Post Date",
      "Description",
      "Category",
      "Type",
      "Amount",
      "Memo",
    ]);
    expect(cols.description).toBe(2);
    expect(cols.amount).toBe(5);
    expect(cols.date).toBe(0);
  });

  it("finds Description on a Capital One export", () => {
    const cols = sniffColumns([
      "Transaction Date",
      "Posted Date",
      "Card No.",
      "Description",
      "Category",
      "Debit",
      "Credit",
    ]);
    expect(cols.description).toBe(3);
  });

  it("still falls back to a Transaction column when there is no Description", () => {
    const cols = sniffColumns(["Date", "Transaction", "Amount"]);
    expect(cols.description).toBe(1);
  });

  it("prefers an Amount column over a Debit column", () => {
    const cols = sniffColumns(["Date", "Description", "Debit", "Amount"]);
    expect(cols.amount).toBe(3);
  });

  it("reports -1 for columns that are not present", () => {
    const cols = sniffColumns(["Foo", "Bar"]);
    expect(cols.description).toBe(-1);
    expect(cols.amount).toBe(-1);
    expect(cols.date).toBe(-1);
    expect(cols.category).toBe(-1);
  });
});

describe("parseAmountCents", () => {
  it("reads the shapes bank exports actually emit", () => {
    expect(parseAmountCents("$-12.34")).toBe(-1234);
    expect(parseAmountCents("(12.34)")).toBe(-1234);
    expect(parseAmountCents("1,234.56")).toBe(123456);
    expect(parseAmountCents("")).toBe(null);
    expect(parseAmountCents("n/a")).toBe(null);
  });
});

describe("parseCsv", () => {
  it("keeps a quoted comma inside one field", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });
});
