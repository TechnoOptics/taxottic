import { describe, it, expect } from "vitest";
import { partitionRows, type DupeCandidate } from "./duplicates";
import { chargeFingerprint } from "@/lib/banking/subscription-dedupe";

function row(
  posted_at: string | null,
  amount_cents: number,
  description: string,
): DupeCandidate {
  return { posted_at, amount_cents, description };
}

describe("partitionRows", () => {
  it("keeps a row nothing has seen before", () => {
    const r = partitionRows([row("2026-01-02", -1234, "COSTCO")], new Set());
    expect(r.fresh).toHaveLength(1);
    expect(r.withinFile).toHaveLength(0);
    expect(r.againstBooks).toHaveLength(0);
  });

  it("flags a row already in the books instead of dropping it silently", () => {
    const prior = new Set([chargeFingerprint("2026-01-02", -1234, "COSTCO")]);
    const r = partitionRows([row("2026-01-02", -1234, "COSTCO")], prior);
    expect(r.fresh).toHaveLength(0);
    expect(r.againstBooks).toHaveLength(1);
    // The caller has to be able to show the user what was held back.
    expect(r.againstBooks[0].row.description).toBe("COSTCO");
    expect(r.againstBooks[0].fingerprint).toBe(
      chargeFingerprint("2026-01-02", -1234, "COSTCO"),
    );
  });

  it("matches the books through cosmetic description differences", () => {
    // chargeFingerprint normalizes punctuation and case, so a statement that
    // re-exports "COSTCO #1234" as "Costco  #1234" is still the same charge.
    const prior = new Set([
      chargeFingerprint("2026-01-02", -1234, "COSTCO WHSE #1234"),
    ]);
    const r = partitionRows(
      [row("2026-01-02", -1234, "costco whse  #1234")],
      prior,
    );
    expect(r.againstBooks).toHaveLength(1);
  });

  it("does NOT match when the cents differ", () => {
    const prior = new Set([chargeFingerprint("2026-01-02", -1234, "COSTCO")]);
    const r = partitionRows([row("2026-01-02", -1235, "COSTCO")], prior);
    expect(r.fresh).toHaveLength(1);
  });

  it("does NOT match when the date differs", () => {
    const prior = new Set([chargeFingerprint("2026-01-02", -1234, "COSTCO")]);
    const r = partitionRows([row("2026-01-03", -1234, "COSTCO")], prior);
    expect(r.fresh).toHaveLength(1);
  });

  it("catches a row duplicated inside the SAME file", () => {
    // The shipped ingest path only compared against prior DB rows, so a file
    // containing the same charge twice imported it twice.
    const r = partitionRows(
      [row("2026-01-02", -1234, "COSTCO"), row("2026-01-02", -1234, "COSTCO")],
      new Set(),
    );
    expect(r.fresh).toHaveLength(1);
    expect(r.withinFile).toHaveLength(1);
    expect(r.withinFile[0].firstIndex).toBe(0);
    expect(r.withinFile[0].index).toBe(1);
  });

  it("keeps a genuine same-day same-amount repeat from a DIFFERENT merchant", () => {
    const r = partitionRows(
      [row("2026-01-02", -500, "STARBUCKS"), row("2026-01-02", -500, "PEETS")],
      new Set(),
    );
    expect(r.fresh).toHaveLength(2);
  });

  it("counts a third occurrence against the first, not the second", () => {
    const r = partitionRows(
      [
        row("2026-01-02", -1234, "COSTCO"),
        row("2026-01-02", -1234, "COSTCO"),
        row("2026-01-02", -1234, "COSTCO"),
      ],
      new Set(),
    );
    expect(r.fresh).toHaveLength(1);
    expect(r.withinFile.map((d) => d.firstIndex)).toEqual([0, 0]);
  });

  it("never dedupes a row with no parsed date", () => {
    // Without a date the fingerprint is not identity, it is a guess, and a
    // wrong guess deletes a real expense. Two undated rows stay two rows.
    const prior = new Set([chargeFingerprint("2026-01-02", -1234, "COSTCO")]);
    const r = partitionRows(
      [row(null, -1234, "COSTCO"), row(null, -1234, "COSTCO")],
      prior,
    );
    expect(r.fresh).toHaveLength(2);
    expect(r.againstBooks).toHaveLength(0);
    expect(r.withinFile).toHaveLength(0);
  });

  it("prefers the books verdict over the within-file verdict", () => {
    // A row that is both already booked AND repeated in the file is reported
    // once, as already-booked, which is the more actionable message.
    const prior = new Set([chargeFingerprint("2026-01-02", -1234, "COSTCO")]);
    const r = partitionRows(
      [row("2026-01-02", -1234, "COSTCO"), row("2026-01-02", -1234, "COSTCO")],
      prior,
    );
    expect(r.fresh).toHaveLength(0);
    expect(r.againstBooks).toHaveLength(2);
    expect(r.withinFile).toHaveLength(0);
  });

  it("preserves the original row order in fresh", () => {
    const r = partitionRows(
      [
        row("2026-01-03", -100, "A"),
        row("2026-01-01", -200, "B"),
        row("2026-01-02", -300, "C"),
      ],
      new Set(),
    );
    expect(r.fresh.map((f) => f.description)).toEqual(["A", "B", "C"]);
  });
});
