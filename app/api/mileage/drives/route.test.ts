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

  // The brief's second source-level test asserted the route never wrote
  // searchParams.get("driver"). It is GONE, on purpose, and nothing
  // text-matching replaces it.
  //
  // Two reasons. It never worked: it pinned the receiver spelling while
  // the route aliases `const sp = req.nextUrl.searchParams` (as the
  // brief's own snippet does), so it stayed GREEN through the very
  // mutation it existed to catch. And the rule it encoded was wrong.
  // Reading `?driver=` is not the danger; TRUSTING it is. The route now
  // reads it and launders it through resolveTripScope against a roster
  // loaded from the caller's own membership, which is that helper's
  // entire purpose. Any regex strict enough to forbid the untrusted read
  // also forbids the laundered one, so keeping it would only pressure
  // someone into writing worse code to satisfy it.
  //
  // "the scope the drives handler pages with" below is the real guard: it
  // pins the exact scope object for every role and parameter shape,
  // including the two that must collapse to `self`.

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
  /** What getMyCompanies() resolves to for the session. */
  memberships: [] as { company_id: string; role: string }[],
  /** company_members rows for the roster read. */
  memberRows: [] as { user_id: string }[],
  /** The rows mileage_trips returns for the ownership probe. The probe
   *  takes a LIST of ids now (one drive is a batch of one), so it
   *  answers with the subset of them that is the caller's. */
  ownedRows: [] as { id: string }[],
  /** Every filter applied to the ownership probe, as [column, value]. */
  ownershipFilters: [] as [string, unknown][],
  /** How many times mileage_trips was read. Every id in a batch must be
   *  checked, and checking them must not cost a query each. */
  ownershipReads: 0,
  /** Every argument the polyline RPC was called with. */
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  /** Rows the polyline RPC returns. */
  polyRows: [] as Record<string, unknown>[],
  /** Every options object handed to loadDrivePage. */
  pageCalls: [] as Record<string, unknown>[],
  /** Rows loadDrivePage returns. */
  pageRows: [] as Record<string, unknown>[],
  /** The company's saved places, as mileage_places returns them. */
  placeRows: [] as Record<string, unknown>[],
  /** Every filter applied to the places read, as [column, value]. */
  placeFilters: [] as [string, unknown][],
}));

/**
 * The slice of the PostgREST builder these two reads use. `then` is what
 * makes the roster read awaitable without a terminal method, the way the
 * real builder is.
 */
type Builder = {
  select: () => Builder;
  eq: (col: string, val: unknown) => Builder;
  in: (col: string, vals: unknown[]) => Builder;
  maybeSingle: () => Promise<{ data: unknown }>;
  then: <T>(onOk: (v: { data: unknown }) => T) => Promise<T>;
};

function builder(
  result: () => { data: unknown },
  sink?: [string, unknown][],
): Builder {
  const b: Builder = {
    select: () => b,
    eq: (col, val) => {
      sink?.push([col, val]);
      return b;
    },
    in: (col, vals) => {
      sink?.push([col, vals]);
      return b;
    },
    maybeSingle: async () => result(),
    then: (onOk) => Promise.resolve(result()).then(onOk),
  };
  return b;
}

vi.mock("@/lib/auth", () => ({
  getMyCompanies: async () => h.memberships,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "company_members")
        return builder(() => ({ data: h.memberRows }));
      if (table === "mileage_places")
        return builder(() => ({ data: h.placeRows }), h.placeFilters);
      h.ownershipReads += 1;
      return builder(() => ({ data: h.ownedRows }), h.ownershipFilters);
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
/** A real user, but not in the caller's company. */
const A_STRANGER = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  h.user = { id: VIEWER };
  // The default caller is an ordinary member of one company.
  h.memberships = [{ company_id: COMPANY, role: "member" }];
  h.memberRows = [{ user_id: VIEWER }];
  h.ownedRows = [{ id: TRIP }];
  h.ownershipFilters = [];
  h.ownershipReads = 0;
  h.rpcCalls = [];
  h.polyRows = [];
  h.pageCalls = [];
  h.pageRows = [];
  h.placeRows = [];
  h.placeFilters = [];
});

describe("the drives handler", () => {
  it("401s an anonymous caller and reads nothing", async () => {
    h.user = null;
    const res = await ask(`?company=${COMPANY}`);
    expect(res.status).toBe(401);
    expect(h.pageCalls, "no query may run without a session").toEqual([]);
    expect(h.rpcCalls).toEqual([]);
  });

  it("never takes a driver id from the query string as given", async () => {
    // Both spellings, including one the route does not read at all. The
    // point is that no parameter reaches the scope unlaundered: this
    // caller is an ordinary member, so resolveTripScope owes them `self`
    // whatever they name. The roster-aware cases are grouped below.
    const res = await ask(
      `?company=${COMPANY}&driver=${SOMEONE_ELSE}&driverUserId=${SOMEONE_ELSE}`,
    );
    expect(res.status).toBe(200);
    expect(h.pageCalls).toHaveLength(1);
    expect(
      h.pageCalls[0].scope,
      "a drive log names where somebody was; a member reads only their own",
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
    // The row, untouched, plus the two ends this drive matched: none.
    expect(await res.json()).toEqual({
      drives: [{ ...h.pageRows[0], startPlace: null, endPlace: null }],
    });
    expect(
      h.placeFilters,
      "a page of drives that matched no place must not read places at all",
    ).toEqual([]);
  });

  it("sends a saved place's NAME, never its id", async () => {
    // The client holds no places, so an id is unreadable to it. A page
    // appended by this route has to arrive already named or the drive
    // log silently forgets where its older drives went, which is the
    // exact regression this feature exists to prevent.
    h.pageRows = [
      {
        id: TRIP,
        started_at: "2026-09-01T12:00:00.000Z",
        start_place_id: "place-1",
        end_place_id: "place-2",
      },
    ];
    h.placeRows = [
      { id: "place-1", kind: "office", label: "Head Office", lat: 44.98, lng: -93.26 },
      // Never named by the user: the kind is the fallback, not a uuid.
      { id: "place-2", kind: "client", label: null, lat: 45.1, lng: -93.2 },
    ];
    const res = await ask(`?company=${COMPANY}`);
    const body = (await res.json()) as {
      drives: { startPlace: unknown; endPlace: unknown }[];
    };
    expect(body.drives[0].startPlace).toEqual({
      label: "Head Office",
      lat: 44.98,
      lng: -93.26,
    });
    expect(body.drives[0].endPlace).toEqual({
      label: "Client",
      lat: 45.1,
      lng: -93.2,
    });
    expect(
      h.placeFilters,
      "places must be read under the same company bound as the drives",
    ).toEqual([["company_id", COMPANY]]);
  });

  it("leaves a place from another company unnamed rather than wrong", async () => {
    h.pageRows = [
      {
        id: TRIP,
        started_at: "2026-09-01T12:00:00.000Z",
        start_place_id: "a-place-this-company-does-not-have",
      },
    ];
    h.placeRows = [
      { id: "place-1", kind: "office", label: "Head Office", lat: 1, lng: 2 },
    ];
    const res = await ask(`?company=${COMPANY}`);
    const body = (await res.json()) as { drives: { startPlace: unknown }[] };
    expect(body.drives[0].startPlace).toBeNull();
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
    // `trip_id` travels with every point, on this path as on the batch
    // path, because a response shape that depends on how many ids were
    // asked for is a trap for whoever adds the second caller. The three
    // fields DriveThumbnail reads are unchanged, which is what "the
    // single-id behaviour still works" means to the only caller it has.
    expect(await res.json()).toEqual({
      points: [
        {
          trip_id: TRIP,
          lat: 41.5,
          lng: -81.7,
          captured_at: "2026-09-01T12:00:00.000Z",
        },
      ],
    });
    expect(h.rpcCalls[0].fn).toBe("mileage_trip_polylines");
    expect(h.rpcCalls[0].args).toMatchObject({ p_trip_ids: [TRIP] });
    expect(
      h.rpcCalls[0].args.p_max,
      "one drive on its own still gets the full 250 vertices",
    ).toBe(250);
  });

  it("checks the trip belongs to the caller", async () => {
    await ask(`?trip=${TRIP}`);
    expect(
      h.ownershipFilters,
      "the probe must pin BOTH the trip ids and the session's driver",
    ).toEqual([
      // One drive is a batch of one: the same `.in()` the batch uses, so
      // there is one ownership path rather than two that can drift.
      ["id", [TRIP]],
      ["driver_user_id", VIEWER],
    ]);
  });

  it("returns no points, and no error, for a trip that is not the caller's", async () => {
    // The probe finds nothing, which is what a foreign or non-existent id
    // looks like. Both must look identical from outside: an error code that
    // distinguishes them turns the endpoint into an id oracle.
    h.ownedRows = [];
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

  it("refuses a teammate's polyline even to a manager", async () => {
    // The LIST may widen to a teammate (a manager pinning one is a product
    // decision that already exists, and the list is filtered to confirmed
    // business drives). A raw GPS track pulled by guessable id is not that
    // decision, so this branch stays strictly the caller's own and does NOT
    // go through resolveTripScope.
    h.memberships = [{ company_id: COMPANY, role: "manager" }];
    h.memberRows = [{ user_id: VIEWER }, { user_id: SOMEONE_ELSE }];
    h.ownedRows = []; // the probe pins driver_user_id to the session
    h.polyRows = [
      {
        trip_id: TRIP,
        lat: 41.5,
        lng: -81.7,
        captured_at: "2026-09-01T12:00:00.000Z",
      },
    ];
    const res = await ask(`?trip=${TRIP}&driver=${SOMEONE_ELSE}`);
    expect(res.status).toBe(200);
    expect(
      await res.json(),
      "a manager may read a teammate's list, not their minute-by-minute track",
    ).toEqual({ points: [] });
  });

  it("prefers the trip branch over paging", async () => {
    await ask(`?trip=${TRIP}&company=${COMPANY}`);
    expect(h.pageCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The scope the route pages with. It has to be the one the PAGE would have
// used, because a manager lands on the team overlay: a route that always
// paged `self` would quietly drop every teammate's drives at page two, which
// reads as "the older drives are missing" rather than as a bug.
// ---------------------------------------------------------------------------

const asManagerOf = (...members: string[]) => {
  h.memberships = [{ company_id: COMPANY, role: "manager" }];
  h.memberRows = members.map((user_id) => ({ user_id }));
};

describe("the scope the drives handler pages with", () => {
  it("pages a solo driver as themselves", async () => {
    await ask(`?company=${COMPANY}`);
    expect(h.pageCalls[0].scope).toEqual({
      kind: "self",
      driverUserId: VIEWER,
    });
  });

  it("pages an ordinary member of a big team as themselves", async () => {
    h.memberships = [{ company_id: COMPANY, role: "member" }];
    h.memberRows = [{ user_id: VIEWER }, { user_id: SOMEONE_ELSE }];
    await ask(`?company=${COMPANY}`);
    expect(
      h.pageCalls[0].scope,
      "a member is not a manager however many colleagues they have",
    ).toEqual({ kind: "self", driverUserId: VIEWER });
  });

  it("pages a manager of a team with the team scope their page uses", async () => {
    asManagerOf(VIEWER, SOMEONE_ELSE);
    await ask(`?company=${COMPANY}`);
    expect(
      h.pageCalls[0].scope,
      "page one shows the whole team, so page two must too",
    ).toEqual({ kind: "team", viewerUserId: VIEWER });
  });

  it("pages a manager who is alone in their company as themselves", async () => {
    asManagerOf(VIEWER);
    await ask(`?company=${COMPANY}`);
    expect(
      h.pageCalls[0].scope,
      "one person is not a team; resolveTripScope owns that rule",
    ).toEqual({ kind: "self", driverUserId: VIEWER });
  });

  // ?driver= is READ, and then laundered. These four pin what laundering
  // means at each role, because "we validate it" is the kind of claim that
  // rots quietly.

  it("keeps a non-manager on their own drives however they ask", async () => {
    h.memberships = [{ company_id: COMPANY, role: "member" }];
    h.memberRows = [{ user_id: VIEWER }, { user_id: SOMEONE_ELSE }];
    await ask(`?company=${COMPANY}&driver=${SOMEONE_ELSE}`);
    expect(
      h.pageCalls[0].scope,
      "a member naming a colleague must not read that colleague",
    ).toEqual({ kind: "self", driverUserId: VIEWER });
  });

  it("collapses a manager naming somebody off their roster to self", async () => {
    asManagerOf(VIEWER, SOMEONE_ELSE);
    await ask(`?company=${COMPANY}&driver=${A_STRANGER}`);
    expect(
      h.pageCalls[0].scope,
      "a manager's reach stops at their own company's roster",
    ).toEqual({ kind: "self", driverUserId: VIEWER });
  });

  it("pages the teammate a manager pinned, so page two does not widen", async () => {
    asManagerOf(VIEWER, SOMEONE_ELSE);
    await ask(`?company=${COMPANY}&driver=${SOMEONE_ELSE}`);
    expect(
      h.pageCalls[0].scope,
      "page one showed one teammate, so page two must show the same one",
    ).toEqual({ kind: "other", driverUserId: SOMEONE_ELSE });
  });

  it("pages the team when a manager asks for all drivers", async () => {
    asManagerOf(VIEWER, SOMEONE_ELSE);
    await ask(`?company=${COMPANY}&driver=all`);
    expect(h.pageCalls[0].scope).toEqual({
      kind: "team",
      viewerUserId: VIEWER,
    });
  });

  it("pages a manager who pinned themselves as self", async () => {
    asManagerOf(VIEWER, SOMEONE_ELSE);
    await ask(`?company=${COMPANY}&driver=${VIEWER}`);
    expect(h.pageCalls[0].scope).toEqual({
      kind: "self",
      driverUserId: VIEWER,
    });
  });

  it("pages nothing for a company the caller does not belong to", async () => {
    h.memberships = [{ company_id: COMPANY, role: "manager" }];
    const res = await ask("?company=99999999-9999-4999-8999-999999999999");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ drives: [] });
    expect(h.pageCalls, "a stranger's company is not queried at all").toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// The batch. The page's 460px map draws every drive it was given, so it asks
// for every route in ONE request; a request per drive is the sixty-round-trip
// bug this branch removed, moved to the client. A batch is therefore a list
// of ids the caller supplied, and a polyline is a location history, so every
// id in it is checked before a single point is read.
// ---------------------------------------------------------------------------

/** A real trip, belonging to somebody who is not the caller. */
const FOREIGN_TRIP = "66666666-6666-4666-8666-666666666666";

const batch = (...ids: string[]) => ask(`?trip=${ids.join(",")}`);

describe("the drives handler, asked for several polylines at once", () => {
  it("returns the caller's points only, and no error, for a batch that names somebody else's drive", async () => {
    // The probe clears one of the two ids. The other is dropped in
    // silence: an error, or a different status, would tell a caller which
    // guessed trip ids are real, which is exactly what the single-id
    // branch refuses to do.
    h.ownedRows = [{ id: TRIP }];
    h.polyRows = [
      { trip_id: TRIP, lat: 41.5, lng: -81.7, captured_at: "2026-09-01T12:00:00.000Z" },
      { trip_id: FOREIGN_TRIP, lat: 44.9, lng: -93.2, captured_at: "2026-09-01T12:01:00.000Z" },
    ];
    const res = await batch(TRIP, FOREIGN_TRIP);
    expect(res.status, "a foreign id in the batch is not an error").toBe(200);
    expect(
      await res.json(),
      "one foreign id in a batch must not drag somebody else's movements back with it",
    ).toEqual({
      points: [
        {
          trip_id: TRIP,
          lat: 41.5,
          lng: -81.7,
          captured_at: "2026-09-01T12:00:00.000Z",
        },
      ],
    });
  });

  it("never names an uncleared id to the point table", async () => {
    h.ownedRows = [{ id: TRIP }];
    await batch(TRIP, FOREIGN_TRIP);
    expect(
      h.rpcCalls[0].args.p_trip_ids,
      "the RPC bypasses RLS: an uncleared id must never reach it",
    ).toEqual([TRIP]);
  });

  it("checks every id in the batch with one query, not one per id", async () => {
    const ids = [TRIP, FOREIGN_TRIP, SOMEONE_ELSE];
    h.ownedRows = [{ id: TRIP }];
    await batch(...ids);
    expect(
      h.ownershipReads,
      "a probe per id is the round-trip bug again, on the server side",
    ).toBe(1);
    expect(
      h.ownershipFilters,
      "the one probe must pin the whole id list AND the session's driver",
    ).toEqual([
      ["id", ids],
      ["driver_user_id", VIEWER],
    ]);
  });

  it("reads nothing at all when the batch clears no ids", async () => {
    h.ownedRows = [];
    const res = await batch(FOREIGN_TRIP);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ points: [] });
    expect(h.rpcCalls, "nothing left to ask the point table for").toEqual([]);
  });

  it("reads nothing at all for a batch of empty strings", async () => {
    const res = await ask("?trip=,,");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ points: [] });
    expect(h.ownershipReads, "there is no id here to check").toBe(0);
    expect(h.rpcCalls).toEqual([]);
  });

  it("caps the batch at one page of drives", async () => {
    // The map draws the drives the page loaded, and that is DRIVE_PAGE_SIZE
    // of them, so the cap never truncates a map the page could build. It
    // bounds what a hand-written query string can ask for.
    const many = Array.from(
      { length: 90 },
      (_, i) => `${i.toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    h.ownedRows = many.map((id) => ({ id }));
    await batch(...many);
    const asked = h.ownershipFilters[0][1] as string[];
    expect(asked, "the batch is capped at one page of drives").toHaveLength(60);
    expect(asked, "the cap keeps the drives asked for first").toEqual(
      many.slice(0, 60),
    );
  });

  it("drops a repeated id rather than asking for it twice", async () => {
    h.ownedRows = [{ id: TRIP }];
    await batch(TRIP, TRIP, TRIP);
    expect(h.ownershipFilters[0][1]).toEqual([TRIP]);
  });

  it("keeps a full batch inside one PostgREST page, so no drive silently loses its route", async () => {
    // PostgREST truncates ANY response at max-rows (1000). The page's old
    // server-side fetch hit this with 250 vertices per drive and paged
    // around it in a loop; one request cannot page, so the vertex budget
    // per drive has to shrink as the batch grows, and the drives that
    // would otherwise fall off the end are the ones sorted last by
    // trip_id, which is effectively random.
    const many = Array.from(
      { length: 60 },
      (_, i) => `${i.toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    h.ownedRows = many.map((id) => ({ id }));
    await batch(...many);
    const perDrive = h.rpcCalls[0].args.p_max as number;
    expect(perDrive, "a route needs more than its two endpoints").toBeGreaterThan(2);
    expect(
      perDrive * 60,
      "a full batch at this vertex budget overruns PostgREST's 1000-row ceiling",
    ).toBeLessThanOrEqual(1000);
  });
});
