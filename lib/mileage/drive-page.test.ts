import { describe, it, expect, vi } from "vitest";
import { DRIVE_PAGE_SIZE, loadDrivePage } from "./drive-page";
import * as scope from "./team-scope";

type FixtureRow = { id: string; started_at: string };

/**
 * A stand-in for loadScopedTrips that behaves like the real query now
 * does: an inclusive upper bound (`beforeIso`), newest-first with id as a
 * tie-break, capped at `limit`. A test built on this exercises the actual
 * pagination contract instead of asserting the shape of a call, which is
 * what let the original "before" bug (no real upper bound) ship unnoticed.
 */
function fakeScopedTrips(all: readonly FixtureRow[]) {
  return async (
    _admin: unknown,
    args: { sinceIso: string; beforeIso?: string; limit?: number },
  ) => {
    const limit = args.limit ?? 500;
    return all
      .filter((r) => r.started_at >= args.sinceIso)
      .filter((r) => !args.beforeIso || r.started_at <= args.beforeIso)
      .sort((a, b) => {
        if (a.started_at !== b.started_at)
          return a.started_at < b.started_at ? 1 : -1;
        if (a.id === b.id) return 0;
        return a.id < b.id ? 1 : -1;
      })
      .slice(0, limit);
  };
}

describe("the drive page has no window", () => {
  it("asks for the newest drives with a floor that excludes nothing", async () => {
    const spy = vi
      .spyOn(scope, "loadScopedTrips")
      .mockResolvedValue([] as never);
    await loadDrivePage(null as never, {
      companyId: "co_1",
      scope: { kind: "self", driverUserId: "u_1" },
    });
    const arg = spy.mock.calls[0][1];
    expect(
      new Date(arg.sinceIso).getUTCFullYear(),
      "a floor inside living memory is a window, and a window is what made this page open empty",
    ).toBeLessThan(2000);
    expect(arg.limit).toBe(DRIVE_PAGE_SIZE);
    spy.mockRestore();
  });

  it("pages older drives strictly before the cursor, excluding a tie at the boundary", async () => {
    const rows = [
      { id: "a", started_at: "2026-09-20T10:00:00.000Z" },
      { id: "b", started_at: "2026-09-19T10:00:00.000Z" },
      // Sits exactly on the cutoff below. Without this row, the cursor
      // filter's `<` vs `<=` boundary is never actually exercised: a
      // reviewer mutated `<` to `<=` and all tests still passed, because
      // no fixture row was ever equal to `before`.
      { id: "cutoff", started_at: "2026-09-20T00:00:00.000Z" },
    ];
    vi.spyOn(scope, "loadScopedTrips").mockResolvedValue(rows as never);
    const out = await loadDrivePage<{ id: string; started_at: string }>(
      null as never,
      {
        companyId: "co_1",
        scope: { kind: "self", driverUserId: "u_1" },
        before: "2026-09-20T00:00:00.000Z",
      },
    );
    expect(
      out.map((r) => r.id),
      "the cursor row must not repeat, and a row exactly at the cutoff with no known tie-break is excluded too",
    ).toEqual(["b"]);
    vi.restoreAllMocks();
  });

  it("defaults the page size to 60", () => {
    expect(DRIVE_PAGE_SIZE).toBe(60);
  });

  it("pages three times through more rows than one page holds, advancing every time", async () => {
    const total = 3 * DRIVE_PAGE_SIZE; // 180: the third page should still be full.
    const all: FixtureRow[] = Array.from({ length: total }, (_, i) => ({
      id: `t${String(i).padStart(4, "0")}`,
      // i = 0 is the most recent; each row is one day older than the last.
      started_at: new Date(
        Date.UTC(2026, 0, 1) - i * 86_400_000,
      ).toISOString(),
    }));
    vi.spyOn(scope, "loadScopedTrips").mockImplementation(
      fakeScopedTrips(all) as never,
    );

    const page1 = await loadDrivePage<FixtureRow>(null as never, {
      companyId: "co_1",
      scope: { kind: "self", driverUserId: "u_1" },
    });
    const last1 = page1[page1.length - 1];
    const page2 = await loadDrivePage<FixtureRow>(null as never, {
      companyId: "co_1",
      scope: { kind: "self", driverUserId: "u_1" },
      before: last1.started_at,
      beforeId: last1.id,
    });
    const last2 = page2[page2.length - 1];
    const page3 = await loadDrivePage<FixtureRow>(null as never, {
      companyId: "co_1",
      scope: { kind: "self", driverUserId: "u_1" },
      before: last2.started_at,
      beforeId: last2.id,
    });

    expect(page1).toHaveLength(DRIVE_PAGE_SIZE);
    expect(page2).toHaveLength(DRIVE_PAGE_SIZE);
    expect(
      page3,
      "the third page must still be full: pagination must not stall",
    ).toHaveLength(DRIVE_PAGE_SIZE);

    const ids1 = new Set(page1.map((r) => r.id));
    const ids2 = new Set(page2.map((r) => r.id));
    const ids3 = new Set(page3.map((r) => r.id));
    const overlaps = (a: Set<string>, b: Set<string>) =>
      [...a].some((id) => b.has(id));
    expect(overlaps(ids1, ids2), "page 2 must share no id with page 1").toBe(
      false,
    );
    expect(overlaps(ids1, ids3), "page 3 must share no id with page 1").toBe(
      false,
    );
    expect(overlaps(ids2, ids3), "page 3 must share no id with page 2").toBe(
      false,
    );
    expect(
      [...page1, ...page2, ...page3].map((r) => r.id),
      "the three pages together are the newest-first 180 rows, in order",
    ).toEqual(all.map((r) => r.id));

    vi.restoreAllMocks();
  });

  it("sorts and caps a team scope's merged rows to the page size on the very first load", async () => {
    // Mirrors the real team branch of loadScopedTrips: "own" rows
    // concatenated before "others" rows, each already capped at `limit`
    // independently, with no cross-source sort applied -- exactly the raw
    // shape loadScopedTrips returns today.
    const olderOwn: FixtureRow[] = Array.from(
      { length: DRIVE_PAGE_SIZE },
      (_, i) => ({
        id: `own${i}`,
        started_at: new Date(
          Date.UTC(2026, 0, 1) - (DRIVE_PAGE_SIZE + i) * 86_400_000,
        ).toISOString(),
      }),
    );
    const newerOthers: FixtureRow[] = Array.from(
      { length: DRIVE_PAGE_SIZE },
      (_, i) => ({
        id: `other${i}`,
        started_at: new Date(
          Date.UTC(2026, 0, 1) - i * 86_400_000,
        ).toISOString(),
      }),
    );
    vi.spyOn(scope, "loadScopedTrips").mockResolvedValue([
      ...olderOwn,
      ...newerOthers,
    ] as never);

    const page = await loadDrivePage<FixtureRow>(null as never, {
      companyId: "co_1",
      scope: { kind: "team", viewerUserId: "u_1" },
    });

    expect(
      page,
      "must not return the raw 2x concatenation unsliced",
    ).toHaveLength(DRIVE_PAGE_SIZE);
    expect(
      page.map((r) => r.id),
      "must be the globally newest rows, not the 'own' block that happened to come first in the concatenation",
    ).toEqual(newerOthers.map((r) => r.id));

    vi.restoreAllMocks();
  });

  it("keeps both rows of a same-instant tie across a page boundary", async () => {
    const tiedInstant = "2026-01-01T00:00:00.000Z";
    const rows: FixtureRow[] = [
      { id: "newest", started_at: "2026-01-02T00:00:00.000Z" },
      { id: "tie-b", started_at: tiedInstant },
      { id: "tie-a", started_at: tiedInstant },
    ];
    vi.spyOn(scope, "loadScopedTrips").mockImplementation(
      fakeScopedTrips(rows) as never,
    );

    const page1 = await loadDrivePage<FixtureRow>(null as never, {
      companyId: "co_1",
      scope: { kind: "self", driverUserId: "u_1" },
      limit: 2,
    });
    expect(page1.map((r) => r.id)).toEqual(["newest", "tie-b"]);

    const last = page1[page1.length - 1];
    const page2 = await loadDrivePage<FixtureRow>(null as never, {
      companyId: "co_1",
      scope: { kind: "self", driverUserId: "u_1" },
      limit: 2,
      before: last.started_at,
      beforeId: last.id,
    });
    expect(
      page2.map((r) => r.id),
      "the tied row not yet shown on page 1 must survive onto page 2, not be dropped",
    ).toEqual(["tie-a"]);

    vi.restoreAllMocks();
  });

  it("drops a row whose started_at cannot be parsed, rather than misplacing it", async () => {
    const rows = [
      { id: "good", started_at: "2026-01-01T00:00:00.000Z" },
      { id: "bad", started_at: "not-a-date" },
    ];
    vi.spyOn(scope, "loadScopedTrips").mockResolvedValue(rows as never);

    const out = await loadDrivePage<FixtureRow>(null as never, {
      companyId: "co_1",
      scope: { kind: "self", driverUserId: "u_1" },
    });

    expect(out.map((r) => r.id)).toEqual(["good"]);
    vi.restoreAllMocks();
  });
});
