import { describe, it, expect } from "vitest";
import {
  fingerprintRow,
  findWithinFileDuplicates,
  splitAlreadyBookedCharges,
  dedupeFindings,
  type ImportRow,
  type ChargeCandidate,
  type ExistingChargeRow,
  type DuplicateFinding,
} from "./duplicates";
import { LIVE_IMPORT_ROWS, ADVERSARIAL_DUPLICATE_ROWS } from "./fixtures/import-62-row";

// Fix round 1 (2026-08-06): the original version of this file matched
// already-booked rows with fingerprintRow/normalizeMerchant, run over
// every parsed row, independent of the pre-existing exact-charge dedupe
// in runCsvImport (which uses a different normalizer, chargeFingerprint
// / normalizeDesc). That let the flagged set and the actually-dropped
// set disagree, in the dangerous direction: rows like
// "SAM'S CLUB 6311 SHAKOPEE" vs "SAM S CLUB 6311 SHAKOPEE" get dropped
// by the dedupe but were never flagged, because the two normalizers
// treat the apostrophe differently. splitAlreadyBookedCharges below IS
// the dedupe's own decision (same chargeFingerprint call), so that
// class of bug cannot recur here: there is only one decision now.

const importRow = (o: Partial<ImportRow> = {}): ImportRow => ({
  index: 0,
  companyId: "company-1",
  description: "DELTA AIR LINES ATLANTA",
  postedAt: "2026-07-07",
  amountCents: 1168463,
  ...o,
});

const chargeCandidate = (o: Partial<ChargeCandidate> = {}): ChargeCandidate => ({
  index: 0,
  description: "DELTA AIR LINES ATLANTA",
  postedAt: "2026-07-07",
  amountCents: 1168463,
  ...o,
});

const existingCharge = (o: Partial<ExistingChargeRow> = {}): ExistingChargeRow => ({
  id: "tx-1",
  importId: "import-prior",
  postedAt: "2026-07-07",
  amountCents: 1168463,
  description: "DELTA AIR LINES ATLANTA",
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
    const rows = [
      importRow({ index: 0, description: "DELTA AIR LINES ATLANTA" }),
      importRow({ index: 1, description: "DELTA AIR LINES ATLANTA" }),
    ];
    const findings = findWithinFileDuplicates(rows);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("within_file");
    expect(findings[0].rowIndex).toBe(1);
    expect(findings[0].existingTransactionId).toBeNull();
    expect(findings[0].existingImportId).toBeNull();
  });

  it("does not pair three Anthropic rows at $20 across two different dates", () => {
    const rows = [
      importRow({ index: 0, description: "ANTHROPIC", postedAt: "2026-07-11", amountCents: 2000 }),
      importRow({ index: 1, description: "ANTHROPIC", postedAt: "2026-07-11", amountCents: 2000 }),
      importRow({ index: 2, description: "ANTHROPIC", postedAt: "2026-07-12", amountCents: 2000 }),
    ];
    const findings = findWithinFileDuplicates(rows);
    // Only the second 07-11 row duplicates the first; the 07-12 row is
    // a distinct fingerprint (different date) and must not be flagged.
    expect(findings).toHaveLength(1);
    expect(findings[0].postedAt).toBe("2026-07-11");
  });

  it("flags both the second and third of three identical rows", () => {
    const rows = [importRow({ index: 0 }), importRow({ index: 1 }), importRow({ index: 2 })];
    const findings = findWithinFileDuplicates(rows);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.kind === "within_file")).toBe(true);
    expect(findings.map((f) => f.rowIndex).sort()).toEqual([1, 2]);
  });

  it("never fingerprints a row with no posted_at or an unparseable amount", () => {
    const rows = [
      importRow({ index: 0, postedAt: null }),
      importRow({ index: 1, postedAt: null }),
      importRow({ index: 2, amountCents: null }),
      importRow({ index: 3, amountCents: null }),
    ];
    expect(findWithinFileDuplicates(rows)).toHaveLength(0);
  });

  it("does not flag distinct rows", () => {
    const rows = [
      importRow({ index: 0, description: "SAMS CLUB", amountCents: 20647 }),
      importRow({ index: 1, description: "AUTOZONE", amountCents: 6773 }),
    ];
    expect(findWithinFileDuplicates(rows)).toHaveLength(0);
  });
});

describe("adversarial merchant-key guard (findWithinFileDuplicates over ADVERSARIAL_DUPLICATE_ROWS)", () => {
  const toRow = (r: (typeof ADVERSARIAL_DUPLICATE_ROWS)[number], index: number): ImportRow => ({
    index,
    companyId: "company-1",
    description: r.description,
    postedAt: r.postedAt,
    amountCents: r.amountCents,
  });

  it("flags only the genuine same-merchant/date/amount repeat, nothing else", () => {
    const rows = ADVERSARIAL_DUPLICATE_ROWS.map(toRow);
    const findings = findWithinFileDuplicates(rows);
    // The only real duplicate in this set is the second Anthropic row
    // on 07-12. Everything else here is deliberately adversarial and
    // must NOT pair:
    //   - the two Launchpad Golf rows differ by amount
    //   - the 07-11 Anthropic row differs by date
    //   - the two Costco rows are different merchants that only look
    //     alike if the merchant key is truncated to one token
    expect(findings).toHaveLength(1);
    expect(findings[0].description).toBe("ANTHROPIC");
    expect(findings[0].postedAt).toBe("2026-07-12");
    expect(findings[0].amountCents).toBe(2000);
  });
});

describe("splitAlreadyBookedCharges", () => {
  it("matches a row against an existing charge and drops it from keptIndexes", () => {
    const rows = [chargeCandidate({ index: 0 })];
    const existing = [existingCharge()];
    const { keptIndexes, duplicates } = splitAlreadyBookedCharges("company-1", rows, existing);
    expect(keptIndexes.has(0)).toBe(false);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].kind).toBe("already_booked");
    expect(duplicates[0].rowIndex).toBe(0);
    expect(duplicates[0].existingTransactionId).toBe("tx-1");
    expect(duplicates[0].existingImportId).toBe("import-prior");
  });

  it("keeps a row with no existing match", () => {
    const rows = [chargeCandidate({ index: 0, description: "NEW MERCHANT", amountCents: 999 })];
    const existing = [existingCharge()];
    const { keptIndexes, duplicates } = splitAlreadyBookedCharges("company-1", rows, existing);
    expect(keptIndexes.has(0)).toBe(true);
    expect(duplicates).toHaveLength(0);
  });

  it("always keeps a row with no posted_at, never matches it", () => {
    const rows = [chargeCandidate({ index: 0, postedAt: null })];
    // Even an existing row with an identical amount/description can't
    // match, because there is no date to fingerprint against.
    const existing = [existingCharge()];
    const { keptIndexes, duplicates } = splitAlreadyBookedCharges("company-1", rows, existing);
    expect(keptIndexes.has(0)).toBe(true);
    expect(duplicates).toHaveLength(0);
  });

  it("does not require the existing row to be applied to an expense or income", () => {
    // The real exact-charge dedupe in runCsvImport has never checked
    // applied_expense_id/applied_income_id: it matches ANY prior row
    // for the company in range. splitAlreadyBookedCharges reproduces
    // that decision exactly, so an "existing" row here needs no applied
    // state to count.
    const rows = [chargeCandidate({ index: 0 })];
    const existing = [existingCharge()];
    const { duplicates } = splitAlreadyBookedCharges("company-1", rows, existing);
    expect(duplicates).toHaveLength(1);
  });

  it("partitions a mixed batch correctly", () => {
    const rows = [
      chargeCandidate({ index: 0, description: "DELTA AIR LINES ATLANTA", amountCents: 1168463 }),
      chargeCandidate({ index: 1, description: "NEW MERCHANT", amountCents: 500 }),
    ];
    const existing = [existingCharge()];
    const { keptIndexes, duplicates } = splitAlreadyBookedCharges("company-1", rows, existing);
    expect(keptIndexes.has(0)).toBe(false);
    expect(keptIndexes.has(1)).toBe(true);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].rowIndex).toBe(0);
  });

  // One prior charge is evidence that ONE charge was already booked, not
  // that every identical charge was. Two $6.50 parking charges on the
  // same day at the same garage is an ordinary Tuesday, and re-importing
  // an overlapping export used to drop both against a single prior row,
  // silently deleting a real deduction from a file the user watched
  // upload successfully.
  it("lets one existing charge absorb only one incoming row", () => {
    const rows = [
      chargeCandidate({ index: 0, description: "PARKING RAMP A", amountCents: 650 }),
      chargeCandidate({ index: 1, description: "PARKING RAMP A", amountCents: 650 }),
    ];
    const existing = [
      existingCharge({ id: "tx-1", description: "PARKING RAMP A", amountCents: 650 }),
    ];
    const { keptIndexes, duplicates } = splitAlreadyBookedCharges("company-1", rows, existing);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].rowIndex).toBe(0);
    expect(keptIndexes.has(0)).toBe(false);
    expect(keptIndexes.has(1)).toBe(true);
  });

  it("absorbs both rows when two identical charges were already booked", () => {
    const rows = [
      chargeCandidate({ index: 0, description: "PARKING RAMP A", amountCents: 650 }),
      chargeCandidate({ index: 1, description: "PARKING RAMP A", amountCents: 650 }),
    ];
    const existing = [
      existingCharge({ id: "tx-1", description: "PARKING RAMP A", amountCents: 650 }),
      existingCharge({ id: "tx-2", description: "PARKING RAMP A", amountCents: 650 }),
    ];
    const { keptIndexes, duplicates } = splitAlreadyBookedCharges("company-1", rows, existing);
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((d) => d.existingTransactionId).sort()).toEqual([
      "tx-1",
      "tx-2",
    ]);
    expect(keptIndexes.size).toBe(0);
  });
});

describe("dedupeFindings", () => {
  const finding = (o: Partial<DuplicateFinding> = {}): DuplicateFinding => ({
    rowIndex: 0,
    companyId: "company-1",
    postedAt: "2026-07-07",
    description: "DELTA AIR LINES ATLANTA",
    amountCents: 1168463,
    fingerprint: "DELTA AIR LINES ATLANTA|2026-07-07|1168463",
    kind: "within_file",
    existingTransactionId: null,
    existingImportId: null,
    ...o,
  });

  it("collapses two findings for the same row into one", () => {
    const findings = [finding({ rowIndex: 5, kind: "within_file" }), finding({ rowIndex: 5, kind: "within_file" })];
    expect(dedupeFindings(findings)).toHaveLength(1);
  });

  it("prefers already_booked over within_file for the same row", () => {
    const findings = [
      finding({ rowIndex: 5, kind: "within_file" }),
      finding({ rowIndex: 5, kind: "already_booked", existingTransactionId: "tx-1", existingImportId: "imp-1" }),
    ];
    const deduped = dedupeFindings(findings);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].kind).toBe("already_booked");
    expect(deduped[0].existingTransactionId).toBe("tx-1");
  });

  it("keeps already_booked even if it arrives before within_file for the same row", () => {
    const findings = [
      finding({ rowIndex: 5, kind: "already_booked", existingTransactionId: "tx-1", existingImportId: "imp-1" }),
      finding({ rowIndex: 5, kind: "within_file" }),
    ];
    const deduped = dedupeFindings(findings);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].kind).toBe("already_booked");
  });

  it("leaves distinct rows (different rowIndex) untouched, including genuinely identical content", () => {
    // Two physically different rows with identical content (e.g. the
    // second and third of three identical within-file rows) must NOT
    // collapse into one just because their content matches; dedupe is
    // by row identity, not by content.
    const findings = [finding({ rowIndex: 1 }), finding({ rowIndex: 2 })];
    expect(dedupeFindings(findings)).toHaveLength(2);
  });
});

describe("fixture: a 62-row file shaped like the real import", () => {
  // NOTE: descriptions and dates in LIVE_IMPORT_ROWS were invented for
  // this branch; this is not the real file, only shaped like it.
  const toImportRow = (r: (typeof LIVE_IMPORT_ROWS)[number], index: number): ImportRow => ({
    index,
    companyId: "company-1",
    description: r.description,
    postedAt: r.postedAt,
    amountCents: r.amountCents,
  });
  const toChargeCandidate = (r: (typeof LIVE_IMPORT_ROWS)[number], index: number): ChargeCandidate => ({
    index,
    description: r.description,
    postedAt: r.postedAt,
    amountCents: r.amountCents,
  });

  it("scanned once (as toInsert, nothing dropped yet), flags only the Delta pair as within_file and nothing else", () => {
    const rows = LIVE_IMPORT_ROWS.map(toImportRow);
    const findings = findWithinFileDuplicates(rows);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("within_file");
    expect(findings[0].description).toBe("DELTA AIR LINES ATLANTA");
    expect(findings[0].amountCents).toBe(1168463);
    expect(findings[0].postedAt).toBe("2026-07-07");
  });

  it("re-imported against itself (every row already sitting in bank_transactions), all 62 are dropped as already_booked", () => {
    const rows = LIVE_IMPORT_ROWS.map(toChargeCandidate);
    const existing: ExistingChargeRow[] = LIVE_IMPORT_ROWS.map((r) => ({
      id: `tx_${r.id}`,
      importId: "prior-import",
      postedAt: r.postedAt,
      amountCents: r.amountCents,
      description: r.description,
    }));
    const { keptIndexes, duplicates } = splitAlreadyBookedCharges("company-1", rows, existing);
    expect(keptIndexes.size).toBe(0);
    expect(duplicates).toHaveLength(62);
    expect(duplicates.every((f) => f.kind === "already_booked")).toBe(true);
    expect(duplicates.every((f) => f.existingImportId === "prior-import")).toBe(true);
  });
});
