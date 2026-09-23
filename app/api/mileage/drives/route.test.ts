import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("app/api/mileage/drives/route.ts", "utf8");

describe("the drives route", () => {
  it("refuses an anonymous caller before it reads anything", () => {
    // The brief spelled the second offset indexOf("loadDrivePage"), which
    // matches the IMPORT line at the top of any file that imports the
    // helper, so nothing could pass it, including the brief's own
    // implementation. Measure the CALL, and measure every read the route
    // makes rather than only the paging one.
    const authAt = SRC.indexOf("auth.getUser");
    const reads = [
      // The call, with or without an explicit type argument.
      ["the drive page", SRC.search(/loadDrivePage(<[^>]*>)?\(/)],
      ["the polyline RPC", SRC.indexOf(".rpc(")],
      ["the ownership probe", SRC.indexOf('.from("mileage_trips")')],
    ] as const;
    expect(authAt, "the route must authenticate").toBeGreaterThan(-1);
    for (const [what, at] of reads) {
      expect(at, `${what} must exist`).toBeGreaterThan(-1);
      expect(
        authAt,
        `a drive log that reads ${what} before it authenticates is a leak`,
      ).toBeLessThan(at);
    }
  });

  it("scopes to the caller rather than to a client-supplied driver", () => {
    expect(
      SRC,
      "taking a driver id from the query string would let anyone read any log",
    ).not.toMatch(/searchParams\.get\(\s*["']driver["']\s*\)/);
  });

  it("asks for one trip's polyline, with no paging loop", () => {
    expect(SRC).toMatch(/mileage_trip_polylines/);
    expect(SRC).not.toMatch(/POLY_PAGE|60_000/);
  });
});

// ---------------------------------------------------------------------------
// Behaviour. The source-level tests above read the file as text, so they
// cannot tell a real check from a comment about one. These call the exported
// handler.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  /** Who auth.getUser() resolves to. null is an anonymous caller. */
  user: null as { id: string } | null,
  /** The row mileage_trips returns for the ownership probe. */
  ownedRow: null as { id: string } | null,
  /** Every filter applied to the ownership probe, as [column, value]. */
  ownershipFilters: [] as [string, unknown][],
  /** Every argument the polyline RPC was called with. */
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  /** Rows the polyline RPC returns. */
  polyRows: [] as Record<string, unknown>[],
  /** Every options object handed to loadDrivePage. */
  pageCalls: [] as Record<string, unknown>[],
  /** Rows loadDrivePage returns. */
  pageRows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
  createServiceClient: () => ({
    from: () => {
      const probe = {
        select: () => probe,
        eq: (col: string, val: unknown) => {
          h.ownershipFilters.push([col, val]);
          return probe;
        },
        maybeSingle: async () => ({ data: h.ownedRow }),
      };
      return probe;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ fn, args });
      return { data: h.polyRows };
    },
  }),
}));

vi.mock("@/lib/mileage/drive-page", () => ({
  DRIVE_PAGE_SIZE: 60,
  loadDrivePage: async (
    _admin: unknown,
    opts: Record<string, unknown>,
  ) => {
    h.pageCalls.push(opts);
    return h.pageRows;
  },
}));

const { GET } = await import("./route");
const { NextRequest } = await import("next/server");

const ask = (query: string) =>
  GET(new NextRequest(`https://taxottic.com/api/mileage/drives${query}`));

const VIEWER = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";
const TRIP = "33333333-3333-4333-8333-333333333333";
const COMPANY = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  h.user = { id: VIEWER };
  h.ownedRow = { id: TRIP };
  h.ownershipFilters = [];
  h.rpcCalls = [];
  h.polyRows = [];
  h.pageCalls = [];
  h.pageRows = [];
});

describe("the drives handler", () => {
  it("401s an anonymous caller and reads nothing", async () => {
    h.user = null;
    const res = await ask(`?company=${COMPANY}`);
    expect(res.status).toBe(401);
    expect(h.pageCalls, "no query may run without a session").toEqual([]);
    expect(h.rpcCalls).toEqual([]);
  });

  it("pages as the session's driver, never the query string's", async () => {
    const res = await ask(
      `?company=${COMPANY}&driver=${SOMEONE_ELSE}&driverUserId=${SOMEONE_ELSE}`,
    );
    expect(res.status).toBe(200);
    expect(h.pageCalls).toHaveLength(1);
    expect(
      h.pageCalls[0].scope,
      "a drive log names where somebody was; the driver comes from the session",
    ).toEqual({ kind: "self", driverUserId: VIEWER });
  });

  it("forwards both halves of the cursor, so tied drives are not skipped", async () => {
    const before = "2026-09-01T12:00:00.000Z";
    await ask(
      `?company=${COMPANY}&before=${encodeURIComponent(before)}&beforeId=${TRIP}`,
    );
    expect(h.pageCalls[0]).toMatchObject({
      companyId: COMPANY,
      before,
      beforeId: TRIP,
      limit: 60,
    });
  });

  it("returns the drives it was given", async () => {
    h.pageRows = [{ id: TRIP, started_at: "2026-09-01T12:00:00.000Z" }];
    const res = await ask(`?company=${COMPANY}`);
    expect(await res.json()).toEqual({ drives: h.pageRows });
  });

  it("400s without a company", async () => {
    const res = await ask("");
    expect(res.status).toBe(400);
    expect(h.pageCalls).toEqual([]);
  });

  it("returns a polyline for the caller's own drive", async () => {
    h.polyRows = [
      {
        trip_id: TRIP,
        lat: 41.5,
        lng: -81.7,
        captured_at: "2026-09-01T12:00:00.000Z",
        driver_user_id: VIEWER,
      },
    ];
    const res = await ask(`?trip=${TRIP}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      points: [
        { lat: 41.5, lng: -81.7, captured_at: "2026-09-01T12:00:00.000Z" },
      ],
    });
    expect(h.rpcCalls[0].fn).toBe("mileage_trip_polylines");
    expect(h.rpcCalls[0].args).toMatchObject({ p_trip_ids: [TRIP] });
  });

  it("checks the trip belongs to the caller", async () => {
    await ask(`?trip=${TRIP}`);
    expect(
      h.ownershipFilters,
      "the probe must pin BOTH the trip id and the session's driver",
    ).toEqual([
      ["id", TRIP],
      ["driver_user_id", VIEWER],
    ]);
  });

  it("returns no points, and no error, for a trip that is not the caller's", async () => {
    // The probe finds nothing, which is what a foreign or non-existent id
    // looks like. Both must look identical from outside: an error code that
    // distinguishes them turns the endpoint into an id oracle.
    h.ownedRow = null;
    h.polyRows = [
      {
        trip_id: TRIP,
        lat: 41.5,
        lng: -81.7,
        captured_at: "2026-09-01T12:00:00.000Z",
      },
    ];
    const res = await ask(`?trip=${TRIP}`);
    expect(res.status).toBe(200);
    expect(
      await res.json(),
      "somebody else's drive log must not come back",
    ).toEqual({ points: [] });
  });

  it("prefers the trip branch over paging", async () => {
    await ask(`?trip=${TRIP}&company=${COMPANY}`);
    expect(h.pageCalls).toEqual([]);
  });
});
