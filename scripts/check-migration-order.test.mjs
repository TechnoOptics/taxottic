import { describe, expect, it } from "vitest";
import {
  findDuplicateTimestamps,
  findOutOfOrderMigrations,
  formatDuplicateError,
  formatOrderError,
  parseMigrationFilename,
} from "./check-migration-order.mjs";

describe("parseMigrationFilename", () => {
  it("accepts a well-formed migration filename", () => {
    expect(parseMigrationFilename("20260808000100_bank_import_scoped_visibility.sql")).toEqual({
      file: "20260808000100_bank_import_scoped_visibility.sql",
      timestamp: "20260808000100",
    });
  });

  it("rejects a filename with no timestamp prefix", () => {
    expect(parseMigrationFilename("bank_import_scoped_visibility.sql")).toBeNull();
  });

  it("rejects a timestamp that isn't exactly 14 digits", () => {
    expect(parseMigrationFilename("2026080800010_short.sql")).toBeNull();
    expect(parseMigrationFilename("202608080001000_long.sql")).toBeNull();
  });

  it("rejects a non-.sql file", () => {
    expect(parseMigrationFilename("20260808000100_notes.txt")).toBeNull();
  });
});

describe("findDuplicateTimestamps", () => {
  it("returns nothing when every timestamp is unique", () => {
    const files = ["20260801000000_a.sql", "20260801000001_b.sql", "20260801000002_c.sql"];
    expect(findDuplicateTimestamps(files)).toEqual([]);
  });

  it("catches the real historical collision (20260725000000)", () => {
    // mileage_trip_source and tracker_alerts_kind both shipped with this
    // timestamp before one was renamed to 20260725000001.
    const files = ["20260725000000_mileage_trip_source.sql", "20260725000000_tracker_alerts_kind.sql"];
    expect(findDuplicateTimestamps(files)).toEqual([
      {
        timestamp: "20260725000000",
        files: ["20260725000000_mileage_trip_source.sql", "20260725000000_tracker_alerts_kind.sql"],
      },
    ]);
  });

  it("reports every group, not just the first", () => {
    const files = [
      "20260801000000_a.sql",
      "20260801000000_b.sql",
      "20260802000000_c.sql",
      "20260802000000_d.sql",
      "20260803000000_unique.sql",
    ];
    expect(findDuplicateTimestamps(files)).toEqual([
      { timestamp: "20260801000000", files: ["20260801000000_a.sql", "20260801000000_b.sql"] },
      { timestamp: "20260802000000", files: ["20260802000000_c.sql", "20260802000000_d.sql"] },
    ]);
  });

  it("ignores files that don't look like migrations", () => {
    const files = ["README.md", "20260801000000_a.sql"];
    expect(findDuplicateTimestamps(files)).toEqual([]);
  });
});

describe("findOutOfOrderMigrations", () => {
  const base = ["20260801000000_a.sql", "20260808000100_bank_import_scoped_visibility.sql"];

  it("passes a new file timestamped after everything on the base ref", () => {
    const working = [...base, "20260808010000_move_booked_transaction.sql"];
    expect(findOutOfOrderMigrations(working, base)).toEqual([]);
  });

  it("flags incident 1: a new file timestamped before the base ref's newest", () => {
    // The RLS fix for the cross-user data leak. Production (proxied here
    // by the base ref) had already applied through 20260808000100; the
    // new file was still stamped 20260801000200.
    const working = [...base, "20260801000200_bank_import_scoped_visibility_fix.sql"];
    expect(findOutOfOrderMigrations(working, base)).toEqual([
      {
        file: "20260801000200_bank_import_scoped_visibility_fix.sql",
        timestamp: "20260801000200",
        newestBaseTimestamp: "20260808000100",
        newestBaseFile: "20260808000100_bank_import_scoped_visibility.sql",
      },
    ]);
  });

  it("flags incident 2: the silent no-op case, a new file tied with the base ref's newest", () => {
    // `supabase db push` printed "Remote database is up to date" and did
    // nothing, exit 0, because this file's timestamp did not sort after
    // what was already applied.
    const working = [...base, "20260808000100_mileage_render_refusals.sql"];
    expect(findOutOfOrderMigrations(working, base)).toEqual([
      {
        file: "20260808000100_mileage_render_refusals.sql",
        timestamp: "20260808000100",
        newestBaseTimestamp: "20260808000100",
        newestBaseFile: "20260808000100_bank_import_scoped_visibility.sql",
      },
    ]);
  });

  it("flags incident 3: --include-all would apply it, but a fresh replay runs it out of order", () => {
    const working = [...base, "20260808000000_bank_imports_complete.sql"];
    const problems = findOutOfOrderMigrations(working, base);
    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe("20260808000000_bank_imports_complete.sql");
  });

  it("leaves pre-existing files alone even though most of history predates the newest", () => {
    // The base ref's own 234 migrations span April through August; only
    // files NEW to this PR are checked against the newest one.
    const working = [...base];
    expect(findOutOfOrderMigrations(working, base)).toEqual([]);
  });

  it("reports multiple offending new files, sorted by filename", () => {
    const working = [...base, "20260801000200_second.sql", "20260801000100_first.sql"];
    const problems = findOutOfOrderMigrations(working, base);
    expect(problems.map((p) => p.file)).toEqual(["20260801000100_first.sql", "20260801000200_second.sql"]);
  });

  it("has nothing to compare against when the base ref has no migrations", () => {
    expect(findOutOfOrderMigrations(["20260101000000_a.sql"], [])).toEqual([]);
  });
});

describe("formatOrderError", () => {
  it("names the file, its timestamp, the timestamp it needs to beat, and the fix", () => {
    const message = formatOrderError(
      {
        file: "20260801000200_bank_import_scoped_visibility.sql",
        timestamp: "20260801000200",
        newestBaseTimestamp: "20260808000100",
        newestBaseFile: "20260808000100_bank_import_scoped_visibility.sql",
      },
      "origin/main"
    );
    expect(message).toContain("20260801000200_bank_import_scoped_visibility.sql");
    expect(message).toContain("20260801000200");
    expect(message).toContain("20260808000100");
    expect(message).toContain("origin/main");
    expect(message).toContain("rename");
    expect(message).toContain("20260808000101");
  });
});

describe("formatDuplicateError", () => {
  it("names every colliding file, the shared timestamp, and the fix", () => {
    const message = formatDuplicateError({
      timestamp: "20260725000000",
      files: ["20260725000000_mileage_trip_source.sql", "20260725000000_tracker_alerts_kind.sql"],
    });
    expect(message).toContain("20260725000000");
    expect(message).toContain("mileage_trip_source");
    expect(message).toContain("tracker_alerts_kind");
    expect(message).toContain("rename");
  });
});
