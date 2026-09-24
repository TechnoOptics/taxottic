import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { entryId, formatEntryDate } from "./changelog-format";

describe("formatEntryDate", () => {
  it("renders a date the way the ledger's data face reads it", () => {
    expect(formatEntryDate("2026-08-06")).toBe("Aug 6, 2026");
  });

  /**
   * The failure this guards is a day slip, and it only shows at a
   * boundary: parsed or formatted in a zone behind UTC, the first of a
   * month renders as the last of the month before, and January 1st
   * renders in the previous YEAR. These three dates are where a
   * regression would be visible; 2026-08-06 above would not move enough
   * to notice.
   */
  it.each([
    ["2026-03-01", "Mar 1, 2026"],
    ["2026-12-31", "Dec 31, 2026"],
    ["2026-01-01", "Jan 1, 2026"],
  ])("holds the calendar date at a boundary: %s", (iso, want) => {
    expect(formatEntryDate(iso)).toBe(want);
  });

  it("does not read the ambient timezone", () => {
    // The formatter is pinned to UTC, so the same call in a zone a day
    // either side of UTC has to return the same string. Set TZ before
    // the call: Intl reads it per-call, not once at import.
    const original = process.env.TZ;
    try {
      const seen = new Set<string>();
      for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Tokyo"]) {
        process.env.TZ = tz;
        seen.add(formatEntryDate("2026-01-01"));
      }
      expect([...seen]).toEqual(["Jan 1, 2026"]);
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("entryId", () => {
  it("is the date plus a slug of the title", () => {
    expect(entryId({ date: "2026-05-12", title: "May 2026 audit fixes" })).toBe(
      "2026-05-12-may-2026-audit-fixes",
    );
  });

  it("is stable: the same entry gives the same anchor every time", () => {
    const e = { date: "2026-08-06", title: "Tick the rows you mean, and finish an import when it is done" };
    const first = entryId(e);
    expect(entryId({ ...e })).toBe(first);
    expect(first).toBe("2026-08-06-tick-the-rows-you-mean-and-finish-an-import-when-it-is-done");
  });

  it("separates two entries that share a date", () => {
    const a = entryId({ date: "2026-08-06", title: "Tick the rows you mean" });
    const b = entryId({ date: "2026-08-06", title: "The home page shows the people it is built for" });
    expect(a).not.toBe(b);
  });

  it("yields an id with no punctuation, spaces or leading and trailing dashes", () => {
    const id = entryId({ date: "2026-05-06", title: "  Education credits (§ 25A)!  " });
    expect(id).toBe("2026-05-06-education-credits-25a");
    expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  /**
   * Every anchor the live page publishes has to be unique, or two rows
   * answer to the same /changelog#... link and one of them is
   * unreachable. Read the ids off the page's own entry list rather than
   * a fixture, so adding an entry that collides fails here.
   */
  it("gives every live changelog entry a unique anchor", () => {
    const src = readFileSync("app/changelog/page.tsx", "utf8");
    const entries = [...src.matchAll(/date: "(\d{4}-\d{2}-\d{2})",\s*\n\s*title: "((?:[^"\\]|\\.)*)"/g)].map(
      (m) => ({ date: m[1], title: m[2].replace(/\\"/g, '"') }),
    );
    expect(entries.length, "the entry list was not parsed").toBeGreaterThan(10);
    const ids = entries.map(entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
