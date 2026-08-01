import { describe, it, expect } from "vitest";
import {
  ALL_DRIVERS,
  FIRM_TRIP_SELECT,
  resolveTripScope,
  loadFirmVisibleTrips,
  loadScopedTrips,
  stripForeignPrivateTrips,
  stripPrivateTrips,
  type TripScope,
} from "./team-scope";

// ---------------------------------------------------------------
// A tiny in-memory stand-in for the PostgREST query builder.
//
// It does NOT just record which filters were requested, it applies
// them to a fixture table and returns the surviving rows. That is the
// point: the privacy test then asserts on the DATA a manager would
// actually receive, so a filter that is dropped, misspelled, or made
// NULL-unsafe fails the test instead of quietly passing a call-shape
// assertion.
// ---------------------------------------------------------------

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

class FakeQuery implements PromiseLike<{ data: Row[] }> {
  private preds: Pred[] = [];
  private cap = Infinity;
  constructor(
    private rows: Row[],
    readonly calls: string[],
  ) {}
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.calls.push(`eq:${col}=${String(val)}`);
    this.preds.push((r) => r[col] === val);
    return this;
  }
  /** PostgREST `neq` compiles to SQL `col <> val`, and `NULL <> anything`
   *  is NULL, not TRUE, so a NULL row is DROPPED. Modelling that faithfully
   *  is what makes the "pre-flag row" test able to catch a NULL-unsafe
   *  rewrite of the confirmation filter. */
  neq(col: string, val: unknown) {
    this.calls.push(`neq:${col}=${String(val)}`);
    this.preds.push((r) => r[col] != null && r[col] !== val);
    return this;
  }
  /** PostgREST `in` compiles to SQL `col IN (…)`. */
  in(col: string, vals: readonly unknown[]) {
    this.calls.push(`in:${col}=[${vals.join(",")}]`);
    this.preds.push((r) => vals.includes(r[col]));
    return this;
  }
  gte(col: string, val: string) {
    this.calls.push(`gte:${col}=${val}`);
    this.preds.push((r) => String(r[col]) >= val);
    return this;
  }
  /** Mirrors PostgREST `not(col, "is", true)` → SQL `NOT (col IS TRUE)`,
   *  which keeps both FALSE and NULL. Any NULL-unsafe rewrite of the
   *  production filter (e.g. `.neq(col, true)`) changes these results. */
  not(col: string, op: string, val: unknown) {
    this.calls.push(`not:${col} ${op} ${String(val)}`);
    if (op !== "is") throw new Error(`fake supports only not(col,"is",…)`);
    this.preds.push((r) => !(r[col] === val));
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.cap = n;
    return this;
  }
  then<A, B>(
    onOk?: ((v: { data: Row[] }) => A | PromiseLike<A>) | null,
    onErr?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const data = this.rows
      .filter((r) => this.preds.every((p) => p(r)))
      .slice(0, this.cap);
    return Promise.resolve({ data }).then(onOk, onErr);
  }
}

function fakeAdmin(rows: Row[]) {
  const queries: FakeQuery[] = [];
  return {
    queries,
    client: {
      from() {
        const q = new FakeQuery(rows, []);
        queries.push(q);
        return q;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

const VIEWER = "viewer-uuid";
const MATE = "teammate-uuid";
const SINCE = "2026-07-01T00:00:00.000Z";

// One row of every shape that matters. The three MATE rows that are not
// confirmed business are the ones that must never reach the manager.
const FIXTURE: Row[] = [
  {
    id: "own-business",
    company_id: "co",
    driver_user_id: VIEWER,
    classification: "business",
    needs_confirmation: null,
    started_at: "2026-07-10T09:00:00.000Z",
  },
  {
    id: "own-personal",
    company_id: "co",
    driver_user_id: VIEWER,
    classification: "personal",
    needs_confirmation: null,
    started_at: "2026-07-10T18:00:00.000Z",
  },
  {
    id: "own-unclassified",
    company_id: "co",
    driver_user_id: VIEWER,
    classification: "unclassified",
    needs_confirmation: null,
    started_at: "2026-07-11T08:00:00.000Z",
  },
  {
    id: "mate-business-confirmed",
    company_id: "co",
    driver_user_id: MATE,
    classification: "business",
    needs_confirmation: false,
    started_at: "2026-07-10T10:00:00.000Z",
  },
  {
    id: "mate-business-legacy-null",
    company_id: "co",
    driver_user_id: MATE,
    classification: "business",
    needs_confirmation: null,
    started_at: "2026-07-10T11:00:00.000Z",
  },
  {
    id: "mate-business-ASSUMED",
    company_id: "co",
    driver_user_id: MATE,
    classification: "business",
    needs_confirmation: true,
    started_at: "2026-07-10T12:00:00.000Z",
  },
  {
    id: "mate-PERSONAL",
    company_id: "co",
    driver_user_id: MATE,
    classification: "personal",
    needs_confirmation: null,
    started_at: "2026-07-10T19:00:00.000Z",
  },
  {
    id: "mate-UNCLASSIFIED",
    company_id: "co",
    driver_user_id: MATE,
    classification: "unclassified",
    needs_confirmation: null,
    started_at: "2026-07-11T07:00:00.000Z",
  },
  {
    id: "other-company",
    company_id: "SOMEONE-ELSE",
    driver_user_id: MATE,
    classification: "business",
    needs_confirmation: false,
    started_at: "2026-07-10T10:00:00.000Z",
  },
  {
    id: "mate-business-too-old",
    company_id: "co",
    driver_user_id: MATE,
    classification: "business",
    needs_confirmation: false,
    started_at: "2026-06-01T10:00:00.000Z",
  },
];

/** Every fixture row a manager must never be shown. */
const FORBIDDEN = [
  "mate-PERSONAL",
  "mate-UNCLASSIFIED",
  "mate-business-ASSUMED",
  "other-company",
];

async function load(scope: TripScope) {
  const { client } = fakeAdmin(FIXTURE);
  const rows = await loadScopedTrips<Row>(client, {
    companyId: "co",
    scope,
    sinceIso: SINCE,
  });
  return rows.map((r) => String(r.id));
}

describe("resolveTripScope", () => {
  const drivers = [VIEWER, MATE];

  it("defaults a manager of a 2+ person team to the whole team", () => {
    expect(
      resolveTripScope({
        isManager: true,
        viewerUserId: VIEWER,
        driverParam: "",
        driverIds: drivers,
      }),
    ).toEqual({ kind: "team", viewerUserId: VIEWER });
  });

  it("keeps honouring an explicit ?driver=all", () => {
    expect(
      resolveTripScope({
        isManager: true,
        viewerUserId: VIEWER,
        driverParam: ALL_DRIVERS,
        driverIds: drivers,
      }).kind,
    ).toBe("team");
  });

  it("lets a manager pin the view to just themselves", () => {
    expect(
      resolveTripScope({
        isManager: true,
        viewerUserId: VIEWER,
        driverParam: VIEWER,
        driverIds: drivers,
      }),
    ).toEqual({ kind: "self", driverUserId: VIEWER });
  });

  it("lets a manager review one named teammate", () => {
    expect(
      resolveTripScope({
        isManager: true,
        viewerUserId: VIEWER,
        driverParam: MATE,
        driverIds: drivers,
      }),
    ).toEqual({ kind: "other", driverUserId: MATE });
  });

  it("pins a solo manager to themselves (no team to show)", () => {
    expect(
      resolveTripScope({
        isManager: true,
        viewerUserId: VIEWER,
        driverParam: "",
        driverIds: [VIEWER],
      }),
    ).toEqual({ kind: "self", driverUserId: VIEWER });
  });

  // --- the authorization half of the privacy rule ---

  it("never gives a non-manager the team view, even asking for it", () => {
    expect(
      resolveTripScope({
        isManager: false,
        viewerUserId: VIEWER,
        driverParam: ALL_DRIVERS,
        driverIds: drivers,
      }),
    ).toEqual({ kind: "self", driverUserId: VIEWER });
  });

  it("never lets a non-manager read a named teammate", () => {
    expect(
      resolveTripScope({
        isManager: false,
        viewerUserId: VIEWER,
        driverParam: MATE,
        driverIds: drivers,
      }),
    ).toEqual({ kind: "self", driverUserId: VIEWER });
  });

  it("falls back to self for a driver id outside the company", () => {
    expect(
      resolveTripScope({
        isManager: true,
        viewerUserId: VIEWER,
        driverParam: "a-stranger-uuid",
        driverIds: drivers,
      }),
    ).toEqual({ kind: "self", driverUserId: VIEWER });
  });
});

describe("loadScopedTrips: a teammate's private drives are unreachable", () => {
  it("team view returns own drives of every kind, teammates' confirmed business only", async () => {
    const ids = await load({ kind: "team", viewerUserId: VIEWER });
    expect(ids.sort()).toEqual(
      [
        "own-business",
        "own-personal",
        "own-unclassified",
        "mate-business-confirmed",
        "mate-business-legacy-null",
      ].sort(),
    );
  });

  it("team view leaks none of the forbidden rows", async () => {
    const ids = await load({ kind: "team", viewerUserId: VIEWER });
    for (const bad of FORBIDDEN) expect(ids).not.toContain(bad);
  });

  it("single-teammate review leaks none of the forbidden rows", async () => {
    const ids = await load({ kind: "other", driverUserId: MATE });
    expect(ids.sort()).toEqual(
      ["mate-business-confirmed", "mate-business-legacy-null"].sort(),
    );
    for (const bad of FORBIDDEN) expect(ids).not.toContain(bad);
  });

  it("an ASSUMED business drive is not a confirmed one, so it stays private", async () => {
    const ids = await load({ kind: "other", driverUserId: MATE });
    expect(ids).not.toContain("mate-business-ASSUMED");
  });

  it("a pre-flag row (needs_confirmation NULL) is still shown", async () => {
    // Guards against rewriting the filter as `.neq(col, true)`, which is
    // NULL-unsafe and would hide every drive recorded before the flag
    // column existed.
    const ids = await load({ kind: "other", driverUserId: MATE });
    expect(ids).toContain("mate-business-legacy-null");
  });

  it("self view is unrestricted: your own personal drives are your own", async () => {
    const ids = await load({ kind: "self", driverUserId: VIEWER });
    expect(ids.sort()).toEqual(
      ["own-business", "own-personal", "own-unclassified"].sort(),
    );
  });

  it("applies the classification + confirmation filters to the teammate query only", async () => {
    const { client, queries } = fakeAdmin(FIXTURE);
    await loadScopedTrips(client, {
      companyId: "co",
      scope: { kind: "team", viewerUserId: VIEWER },
      sinceIso: SINCE,
    });
    expect(queries).toHaveLength(2);
    const own = queries.find((q) =>
      q.calls.some((c) => c === `eq:driver_user_id=${VIEWER}`),
    )!;
    const others = queries.find((q) =>
      q.calls.some((c) => c === `neq:driver_user_id=${VIEWER}`),
    )!;
    expect(others.calls).toContain("eq:classification=business");
    expect(others.calls).toContain("not:needs_confirmation is true");
    expect(own.calls).not.toContain("eq:classification=business");
    expect(own.calls).not.toContain("not:needs_confirmation is true");
  });
});

describe("stripForeignPrivateTrips (last line of defence before render)", () => {
  it("removes a foreign private row even if the query somehow returned it", () => {
    const kept = stripForeignPrivateTrips(FIXTURE, VIEWER).map((r) =>
      String(r.id),
    );
    for (const bad of ["mate-PERSONAL", "mate-UNCLASSIFIED", "mate-business-ASSUMED"])
      expect(kept).not.toContain(bad);
    expect(kept).toContain("own-personal");
    expect(kept).toContain("mate-business-confirmed");
  });

  it("treats a row with an unknown driver as foreign, not as the viewer's", () => {
    const kept = stripForeignPrivateTrips(
      [{ id: "x", driver_user_id: null, classification: "personal" }],
      VIEWER,
    );
    expect(kept).toEqual([]);
  });
});

// ---------------------------------------------------------------
// The outside firm. A different actor from a company manager, and the
// counterparty here is outside the company altogether, so the rule is
// strictly tighter: there is no "your own data" exemption at all.
// ---------------------------------------------------------------

async function loadFirm(companyIds: string[]) {
  const { client, queries } = fakeAdmin(FIXTURE);
  const rows = await loadFirmVisibleTrips<Row>(client, {
    companyIds,
    sinceIso: SINCE,
  });
  return { ids: rows.map((r) => String(r.id)), queries };
}

describe("loadFirmVisibleTrips: an outside firm sees no one's private drives", () => {
  it("returns confirmed business drives only, from every engaged company", async () => {
    const { ids } = await loadFirm(["co"]);
    expect(ids.sort()).toEqual(
      [
        "own-business",
        "mate-business-confirmed",
        "mate-business-legacy-null",
      ].sort(),
    );
  });

  it("leaks none of the rows a manager is already denied", async () => {
    const { ids } = await loadFirm(["co"]);
    for (const bad of FORBIDDEN) expect(ids).not.toContain(bad);
  });

  it("denies the firm EVERY driver's personal drives, with no self exemption", async () => {
    // The crux of the firm rule. A manager viewing their own page keeps
    // "own-personal" because it is their own data; to an outside firm no
    // drive is its own data, so the same row must disappear.
    const { ids } = await loadFirm(["co"]);
    expect(ids).not.toContain("own-personal");
    expect(ids).not.toContain("own-unclassified");
    expect(stripForeignPrivateTrips(FIXTURE, VIEWER).map((r) => r.id)).toContain(
      "own-personal",
    );
  });

  it("an ASSUMED business drive is not evidence, so the firm does not get it", async () => {
    const { ids } = await loadFirm(["co"]);
    expect(ids).not.toContain("mate-business-ASSUMED");
  });

  it("a pre-flag row (needs_confirmation NULL) is still shown", async () => {
    // Guards against a NULL-unsafe `.neq(col, true)` rewrite, which would
    // blank the firm's map entirely for any company with no backfill.
    const { ids } = await loadFirm(["co"]);
    expect(ids).toContain("mate-business-legacy-null");
  });

  it("scopes to the engaged companies and nothing else", async () => {
    const { ids: one } = await loadFirm(["co"]);
    expect(one).not.toContain("other-company");
    const { ids: both } = await loadFirm(["co", "SOMEONE-ELSE"]);
    expect(both).toContain("other-company");
  });

  it("applies the classification + confirmation filters in the query", async () => {
    const { queries } = await loadFirm(["co"]);
    expect(queries).toHaveLength(1);
    expect(queries[0].calls).toContain("eq:classification=business");
    expect(queries[0].calls).toContain("not:needs_confirmation is true");
  });

  it("issues no query at all for a firm with no engagements", async () => {
    const { ids, queries } = await loadFirm([]);
    expect(ids).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("selects needs_confirmation, or the in-memory backstop cannot see it", () => {
    // An unselected column arrives as `undefined`, which passes a
    // `!== true` test and would silently make stripPrivateTrips a no-op.
    expect(FIRM_TRIP_SELECT).toContain("needs_confirmation");
  });
});

describe("stripPrivateTrips (last line of defence before the firm's map renders)", () => {
  it("keeps only confirmed business rows, whoever drove them", () => {
    const kept = stripPrivateTrips(FIXTURE).map((r) => String(r.id));
    expect(kept.sort()).toEqual(
      [
        "own-business",
        "mate-business-confirmed",
        "mate-business-legacy-null",
        "other-company",
        "mate-business-too-old",
      ].sort(),
    );
  });

  it("removes a private row even if the query somehow returned it", () => {
    for (const bad of [
      "own-personal",
      "own-unclassified",
      "mate-PERSONAL",
      "mate-UNCLASSIFIED",
      "mate-business-ASSUMED",
    ])
      expect(stripPrivateTrips(FIXTURE).map((r) => String(r.id))).not.toContain(
        bad,
      );
  });
});
