import { describe, it, expect } from "vitest";
import {
  fingerprintRow,
  findWithinFileDuplicates,
  findAlreadyBookedDuplicates,
  type ImportRow,
  type ExistingBookedRow,
} from "./duplicates";
import { LIVE_IMPORT_ROWS } from "./fixtures/import-62-row";

const row = (o: Partial<ImportRow> = {}): ImportRow => ({
  companyId: "company-1",
  description: "DELTA AIR LINES ATLANTA",
  postedAt: "2026-07-07",
  amountCents: 1168463,
  ...o,
});

const existingRow = (o: Partial<ExistingBookedRow> = {}): ExistingBookedRow => ({
  id: "tx-1",
  importId: "import-prior",
  companyId: "company-1",
  description: "DELTA AIR LINES ATLANTA",
  postedAt: "2026-07-07",
  amountCents: 1168463,
  appliedExpenseId: "exp-1",
  appliedIncomeId: null,
  ...o,
});

describe("fingerprintRow", () => {
  it("matches DELTA AIR LINES against DELTA AIR LINES ATLANTA on the same day and amount", () => {
    const a = fingerprintRow({
      description: "DELTA AIR LINES",
      postedAt: "2026-07-07",
      amountCents: 1168463,
    });
    const b = fingerprintRow({
      description: "DELTA AIR LINES ATLANTA",
      postedAt: "2026-07-07",
      amountCents: 1168463,
    });
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("returns null when posted_at is missing", () => {
    expect(
      fingerprintRow({
        description: "DELTA AIR LINES",
        postedAt: null,
        amountCents: 1168463,
      }),
    ).toBeNull();
  });

  it("returns null when the amount is unparseable", () => {
    expect(
      fingerprintRow({
        description: "DELTA AIR LINES",
        postedAt: "2026-07-07",
        amountCents: null,
      }),
    ).toBeNull();
  });

  it("does not match different amounts on the same day and merchant", () => {
    const a = fingerprintRow({
      description: "DELTA AIR LINES ATLANTA",
      postedAt: "2026-07-07",
      amountCents: 1168463,
    });
    const b = fingerprintRow({
      description: "DELTA AIR LINES ATLANTA",
      postedAt: "2026-07-07",
      amountCents: 2000,
    });
    expect(a).not.toBe(b);
  });
});

describe("findWithinFileDuplicates", () => {
  it("pairs two identical Delta rows, flagging only the second", () => {
    const rows = [row({ description: "DELTA AIR LINES ATLANTA" }), row({ description: "DELTA AIR LINES ATLANTA" })];
    const findings = findWithinFileDuplicates(rows);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("within_file");
    expect(findings[0].existingTransactionId).toBeNull();
    expect(findings[0].existingImportId).toBeNull();
  });

  it("does not pair three Anthropic rows at $20 across two different dates", () => {
    const rows = [
      row({ description: "ANTHROPIC", postedAt: "2026-07-11", amountCents: 2000 }),
      row({ description: "ANTHROPIC", postedAt: "2026-07-11", amountCents: 2000 }),
      row({ description: "ANTHROPIC", postedAt: "2026-07-12", amountCents: 2000 }),
    ];
    const findings = findWithinFileDuplicates(rows);
    // Only the second 07-11 row duplicates the first; the 07-12 row is
    // a distinct fingerprint (different date) and must not be flagged.
    expect(findings).toHaveLength(1);
    expect(findings[0].postedAt).toBe("2026-07-11");
  });

  it("flags both the second and third of three identical rows", () => {
    const rows = [row(), row(), row()];
    const findings = findWithinFileDuplicates(rows);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.kind === "within_file")).toBe(true);
  });

  it("never fingerprints a row with no posted_at or an unparseable amount", () => {
    const rows = [
      row({ postedAt: null }),
      row({ postedAt: null }),
      row({ amountCents: null }),
      row({ amountCents: null }),
    ];
    expect(findWithinFileDuplicates(rows)).toHaveLength(0);
  });

  it("does not flag distinct rows", () => {
    const rows = [
      row({ description: "SAMS CLUB", amountCents: 20647 }),
      row({ description: "AUTOZONE", amountCents: 6773 }),
    ];
    expect(findWithinFileDuplicates(rows)).toHaveLength(0);
  });
});

describe("findAlreadyBookedDuplicates", () => {
  it("matches a row against an already-booked existing transaction", () => {
    const rows = [row()];
    const existing = [existingRow()];
    const findings = findAlreadyBookedDuplicates(rows, existing);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("already_booked");
    expect(findings[0].existingTransactionId).toBe("tx-1");
    expect(findings[0].existingImportId).toBe("import-prior");
  });

  it("ignores existing rows still under review (not applied to an expense or income)", () => {
    const rows = [row()];
    const existing = [existingRow({ appliedExpenseId: null, appliedIncomeId: null })];
    expect(findAlreadyBookedDuplicates(rows, existing)).toHaveLength(0);
  });

  it("matches on applied_income_id too, not just applied_expense_id", () => {
    const rows = [row()];
    const existing = [existingRow({ appliedExpenseId: null, appliedIncomeId: "inc-1" })];
    const findings = findAlreadyBookedDuplicates(rows, existing);
    expect(findings).toHaveLength(1);
  });

  it("never crosses company_id, even on an identical fingerprint", () => {
    const rows = [row({ companyId: "company-1" })];
    const existing = [existingRow({ companyId: "company-2" })];
    expect(findAlreadyBookedDuplicates(rows, existing)).toHaveLength(0);
  });

  it("does not flag a row with no existing match", () => {
    const rows = [row({ description: "NEW MERCHANT", amountCents: 999 })];
    const existing = [existingRow()];
    expect(findAlreadyBookedDuplicates(rows, existing)).toHaveLength(0);
  });
});

describe("fixtures: the real 62-row file", () => {
  const toImportRow = (r: (typeof LIVE_IMPORT_ROWS)[number]): ImportRow => ({
    companyId: "company-1",
    description: r.description,
    postedAt: r.postedAt,
    amountCents: r.amountCents,
  });

  it("scanned once, flags only the Delta pair as within_file and nothing else", () => {
    const rows = LIVE_IMPORT_ROWS.map(toImportRow);
    const findings = findWithinFileDuplicates(rows);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("within_file");
    expect(findings[0].description).toBe("DELTA AIR LINES ATLANTA");
    expect(findings[0].amountCents).toBe(1168463);
    expect(findings[0].postedAt).toBe("2026-07-07");
  });

  it("re-imported against itself (every row previously booked), flags all 62 as already_booked", () => {
    const rows = LIVE_IMPORT_ROWS.map(toImportRow);
    const existing: ExistingBookedRow[] = LIVE_IMPORT_ROWS.map((r) => ({
      id: `tx_${r.id}`,
      importId: "prior-import",
      companyId: "company-1",
      description: r.description,
      postedAt: r.postedAt,
      amountCents: r.amountCents,
      appliedExpenseId: `exp_${r.id}`,
      appliedIncomeId: null,
    }));
    const findings = findAlreadyBookedDuplicates(rows, existing);
    expect(findings).toHaveLength(62);
    expect(findings.every((f) => f.kind === "already_booked")).toBe(true);
    expect(findings.every((f) => f.existingImportId === "prior-import")).toBe(true);
  });
});
