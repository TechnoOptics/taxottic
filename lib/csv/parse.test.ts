import { describe, it, expect } from "vitest";
import { parseCsv, sniffColumns, parseAmountCents } from "./parse";

/**
 * These rows become tax deductions, so a parse bug is a wrong number on a
 * Schedule C. The cases below are the ones real bank exports actually
 * produce, not hypotheticals.
 */

describe("parseCsv", () => {
  it("parses a plain file", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles CRLF", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('a,b\n"AMAZON, INC",-12.34')).toEqual([
      ["a", "b"],
      ["AMAZON, INC", "-12.34"],
    ]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a,b\n"line one\nline two",5')).toEqual([
      ["a", "b"],
      ["line one\nline two", "5"],
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([["a"], ['say "hi"']]);
  });

  it("strips a leading UTF-8 BOM from the first header", () => {
    // Excel writes a BOM on "Save as CSV". Left in place it becomes part of
    // the first header name, which is how a Date column stops being found.
    const rows = parseCsv("﻿Date,Amount\n2026-01-02,-1.00");
    expect(rows[0][0]).toBe("Date");
  });

  it("does not treat a quote in the MIDDLE of a field as an opening quote", () => {
    // 6" PIPE is a real merchant line. Treating that quote as field-opening
    // swallowed the rest of the row, including the amount.
    expect(parseCsv('a,b\n6" PIPE,-9.99')).toEqual([
      ["a", "b"],
      ['6" PIPE', "-9.99"],
    ]);
  });

  it("skips blank lines but keeps an all-empty-fields row", () => {
    expect(parseCsv("a,b\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a trailing empty field", () => {
    expect(parseCsv("a,b,c\n1,2,")).toEqual([
      ["a", "b", "c"],
      ["1", "2", ""],
    ]);
  });

  it("handles a file with no trailing newline", () => {
    expect(parseCsv("a\n1")).toEqual([["a"], ["1"]]);
  });
});

describe("sniffColumns", () => {
  it("finds the usual headers", () => {
    const c = sniffColumns(["Posted Date", "Description", "Amount", "Category"]);
    expect(c).toEqual({ date: 0, description: 1, amount: 2, category: 3 });
  });

  it("finds headers through a BOM on the first cell", () => {
    const c = sniffColumns(["﻿Date", "Description", "Amount"]);
    expect(c.date).toBe(0);
  });

  it("reports -1 for a missing column", () => {
    expect(sniffColumns(["Foo", "Bar"]).amount).toBe(-1);
  });
});

describe("parseAmountCents", () => {
  it("parses a plain decimal", () => {
    expect(parseAmountCents("12.34")).toBe(1234);
  });

  it("parses a leading-minus negative", () => {
    expect(parseAmountCents("-12.34")).toBe(-1234);
  });

  it("parses a currency symbol", () => {
    expect(parseAmountCents("$12.34")).toBe(1234);
    expect(parseAmountCents("-$12.34")).toBe(-1234);
  });

  it("parses thousands separators", () => {
    expect(parseAmountCents("1,234.56")).toBe(123456);
  });

  it("parses parenthesised negatives", () => {
    expect(parseAmountCents("(12.34)")).toBe(-1234);
    expect(parseAmountCents("($1,234.56)")).toBe(-123456);
  });

  it("parses a TRAILING minus", () => {
    // Quicken and several credit unions export "12.34-".
    expect(parseAmountCents("12.34-")).toBe(-1234);
  });

  it("parses a CR / DR suffix", () => {
    // CR is a credit (money in), DR a debit (money out).
    expect(parseAmountCents("12.34 DR")).toBe(-1234);
    expect(parseAmountCents("12.34 CR")).toBe(1234);
  });

  it("parses a whole number with no decimal point", () => {
    expect(parseAmountCents("25")).toBe(2500);
  });

  it("parses a single decimal place", () => {
    expect(parseAmountCents("12.3")).toBe(1230);
  });

  it("is exact on values a float multiply gets wrong", () => {
    // 1234.565 * 100 is 123456.49999999999 in IEEE-754, so Math.round gives
    // 123456, a cent short. Money is parsed from the digits, not multiplied.
    expect(parseAmountCents("1234.565")).toBe(123457);
    expect(parseAmountCents("8.615")).toBe(862);
  });

  it("stays exact across a large statement value", () => {
    expect(parseAmountCents("1234567.89")).toBe(123456789);
  });

  it("truncates beyond two decimals rather than inventing precision", () => {
    // Sub-cent values only appear in FX lines; round to the nearest cent.
    expect(parseAmountCents("12.344")).toBe(1234);
    expect(parseAmountCents("12.346")).toBe(1235);
  });

  it("returns null for text", () => {
    expect(parseAmountCents("N/A")).toBeNull();
    expect(parseAmountCents("")).toBeNull();
    expect(parseAmountCents("--")).toBeNull();
  });

  it("returns 0 for an explicit zero, distinct from null", () => {
    // The caller writes `?? 0`, so null and 0 must not be confused: an
    // unparseable amount becoming a silent $0.00 row is a data-loss bug.
    expect(parseAmountCents("0.00")).toBe(0);
    expect(parseAmountCents("$0.00")).toBe(0);
  });

  it("handles surrounding whitespace", () => {
    expect(parseAmountCents("  -12.34  ")).toBe(-1234);
  });

  it("does not read a negative twice", () => {
    // "-12.34-" is malformed; do not let two minus signs cancel to positive.
    expect(parseAmountCents("-12.34-")).toBe(-1234);
  });
});
