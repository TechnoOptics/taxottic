import { describe, it, expect } from "vitest";
import {
  AWAITING_DECISION_OR,
  applyAwaitingDecisionFilter,
  assumedCall,
  countDrivesAwaitingDecision,
  isAwaitingDecision,
} from "./awaiting-decision";

// ---------------------------------------------------------------
// An in-memory stand-in for the PostgREST builder, in the same spirit
// as team-scope.test.ts: it APPLIES the filters to a fixture rather
// than recording that they were asked for, so a filter that is dropped,
// misspelled or made NULL-unsafe changes the numbers these tests read.
// ---------------------------------------------------------------

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

class FakeQuery implements PromiseLike<{ count: number | null; error: unknown }> {
  private preds: Pred[] = [];
  constructor(
    private rows: Row[],
    readonly calls: string[],
    private failWith: unknown = null,
  ) {}
  select(_cols: string, opts?: { count?: string; head?: boolean }) {
    this.calls.push(`select:${opts?.count ?? "rows"}:${opts?.head ? "head" : "body"}`);
    return this;
  }
  eq(col: string, val: unknown) {
    this.calls.push(`eq:${col}=${String(val)}`);
    this.preds.push((r) => r[col] === val);
    return this;
  }
  /** PostgREST `neq` is SQL `col <> val`; `NULL <> x` is NULL, so a NULL
   *  row is DROPPED. Modelled faithfully so a NULL-unsafe rewrite shows up. */
  neq(col: string, val: unknown) {
    this.calls.push(`neq:${col}=${String(val)}`);
    this.preds.push((r) => r[col] != null && r[col] !== val);
    return this;
  }
  gte(col: string, val: unknown) {
    this.calls.push(`gte:${col}=${String(val)}`);
    this.preds.push((r) => String(r[col]) >= String(val));
    return this;
  }
  /** PostgREST `.or("a.eq.x,b.is.true")` → SQL `(a = x OR b IS TRUE)`. */
  or(expr: string) {
    this.calls.push(`or:${expr}`);
    const terms = expr.split(",").map((t) => {
      const [col, op, raw] = t.split(".");
      if (op === "eq") return (r: Row) => r[col] === raw;
      if (op === "is" && raw === "true") return (r: Row) => r[col] === true;
      if (op === "is" && raw === "null") return (r: Row) => r[col] == null;
      throw new Error(`fake does not model or-term "${t}"`);
    });
    this.preds.push((r) => terms.some((t) => t(r)));
    return this;
  }
  then<A, B>(
    onOk?: ((v: { count: number | null; error: unknown }) => A | PromiseLike<A>) | null,
    onErr?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    if (this.failWith)
      return Promise.resolve({ count: null, error: this.failWith }).then(
        onOk,
        onErr,
      );
    const count = this.rows.filter((r) => this.preds.every((p) => p(r))).length;
    return Promise.resolve({ count, error: null }).then(onOk, onErr);
  }
}

function fakeAdmin(rows: Row[], failWith: unknown = null) {
  const queries: FakeQuery[] = [];
  return {
    queries,
    client: {
      from(table: string) {
        const q = new FakeQuery(rows, [`from:${table}`], failWith);
        queries.push(q);
        return q;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

const ME = "driver-uuid";
const MATE = "teammate-uuid";
const OLD = "2026-06-01T09:00:00.000Z";
const TODAY = "2026-08-24T09:00:00.000Z";

const FIXTURE: Row[] = [
  // The one the old count already saw.
  {
    id: "unclassified",
    driver_user_id: ME,
    classification: "unclassified",
    needs_confirmation: null,
    started_at: OLD,
  },
  // THE BUG. Classified business by the machine, never agreed to by the
  // driver, excluded from the Schedule C headline by #616, and invisible
  // to every count on the page.
  {
    id: "assumed-business",
    driver_user_id: ME,
    classification: "business",
    needs_confirmation: true,
    started_at: TODAY,
  },
  {
    id: "assumed-personal",
    driver_user_id: ME,
    classification: "personal",
    needs_confirmation: true,
    started_at: TODAY,
  },
  // Settled. The driver already decided; nothing is being asked of them.
  {
    id: "confirmed-business",
    driver_user_id: ME,
    classification: "business",
    needs_confirmation: false,
    started_at: TODAY,
  },
  // Written before the confirmation migration. Settled, not pending: the
  // direction of the NULL default is what keeps an old account's whole
  // history out of the queue.
  {
    id: "pre-flag-business",
    driver_user_id: ME,
    classification: "business",
    needs_confirmation: null,
    started_at: OLD,
  },
  {
    id: "personal",
    driver_user_id: ME,
    classification: "personal",
    needs_confirmation: false,
    started_at: OLD,
  },
  // "I was a passenger" is a decision the driver already made. It belongs
  // in no list and no total, so it must not be dragged back into a queue.
  {
    id: "passenger-flagged",
    driver_user_id: ME,
    classification: "passenger",
    needs_confirmation: true,
    started_at: TODAY,
  },
  {
    id: "mate-unclassified",
    driver_user_id: MATE,
    classification: "unclassified",
    needs_confirmation: null,
    started_at: TODAY,
  },
  {
    id: "mate-assumed",
    driver_user_id: MATE,
    classification: "business",
    needs_confirmation: true,
    started_at: TODAY,
  },
];

describe("isAwaitingDecision", () => {
  it("counts a drive the machine guessed and the driver never agreed with", () => {
    expect(
      isAwaitingDecision({
        classification: "business",
        needs_confirmation: true,
      }),
    ).toBe(true);
  });

  it("counts a drive with no classification at all", () => {
    expect(
      isAwaitingDecision({
        classification: "unclassified",
        needs_confirmation: null,
      }),
    ).toBe(true);
  });

  it("leaves a confirmed business drive alone", () => {
    expect(
      isAwaitingDecision({
        classification: "business",
        needs_confirmation: false,
      }),
    ).toBe(false);
  });

  it("leaves a pre-migration row (needs_confirmation NULL) alone", () => {
    // Defaulting the other way would put every drive predating the
    // confirmation migration into the queue: 119 rows in production.
    expect(
      isAwaitingDecision({
        classification: "business",
        needs_confirmation: null,
      }),
    ).toBe(false);
  });

  it("never asks again about a drive the driver marked passenger", () => {
    expect(
      isAwaitingDecision({
        classification: "passenger",
        needs_confirmation: true,
      }),
    ).toBe(false);
  });
});

describe("assumedCall", () => {
  it("names the call the machine made, so the deck can say so", () => {
    // Without this the review deck presents an assumed-business drive as
    // if nothing had been decided, and the driver who already saw it
    // logged as business on the trip list wonders why it is back.
    expect(
      assumedCall({ classification: "business", needs_confirmation: true }),
    ).toBe("business");
    expect(
      assumedCall({ classification: "personal", needs_confirmation: true }),
    ).toBe("personal");
  });

  it("reports nothing for a drive that carries no call at all", () => {
    expect(
      assumedCall({ classification: "unclassified", needs_confirmation: null }),
    ).toBe(null);
  });

  it("reports nothing for a drive the driver already confirmed", () => {
    // Belt and braces: a settled drive never reaches the deck, and if one
    // ever did, telling the driver it was assumed would be a plain lie.
    expect(
      assumedCall({ classification: "business", needs_confirmation: false }),
    ).toBe(null);
    expect(
      assumedCall({ classification: "business", needs_confirmation: null }),
    ).toBe(null);
  });
});

describe("countDrivesAwaitingDecision", () => {
  it("counts the unclassified AND the unconfirmed drives", async () => {
    const { client } = fakeAdmin(FIXTURE);
    // unclassified + assumed-business + assumed-personal. Not the
    // passenger one, not the settled ones, not the teammate's.
    await expect(countDrivesAwaitingDecision(client, ME)).resolves.toBe(3);
  });

  it("agrees exactly with isAwaitingDecision over the same rows", async () => {
    // The query and the in-memory rule are two statements of one policy.
    // Nothing else stops them drifting apart, and a drift means the pill
    // shows a number the deck cannot act on.
    const { client } = fakeAdmin(FIXTURE);
    const mine = FIXTURE.filter((r) => r.driver_user_id === ME);
    const expected = mine.filter((r) =>
      isAwaitingDecision(
        r as { classification: string; needs_confirmation: boolean | null },
      ),
    ).length;
    await expect(countDrivesAwaitingDecision(client, ME)).resolves.toBe(
      expected,
    );
  });

  it("never counts another driver's drives", async () => {
    const { client, queries } = fakeAdmin(FIXTURE);
    await countDrivesAwaitingDecision(client, ME);
    expect(queries[0].calls).toContain(`eq:driver_user_id=${ME}`);
  });

  it("asks the database for a count, not for the rows", async () => {
    // The page already pays for six parallel reads. This one joins that
    // group and must stay a single head request: pulling bodies back to
    // length them would put the #603/#604 payload work back on the page.
    const { client, queries } = fakeAdmin(FIXTURE);
    await countDrivesAwaitingDecision(client, ME);
    expect(queries[0].calls).toContain("select:exact:head");
  });

  it("ignores the page's date range, so switching to Today cannot hide the backlog", async () => {
    // THE REPORTED SYMPTOM. /mileage defaults to range=day. In production
    // on 2026-08-24 one driver held ten drives awaiting a decision and
    // none of them started today, so a range-scoped count showed zero and
    // the banner never appeared. The count is deliberately all-time.
    const { client, queries } = fakeAdmin(FIXTURE);
    await countDrivesAwaitingDecision(client, ME);
    expect(queries[0].calls.some((c) => c.startsWith("gte:started_at"))).toBe(
      false,
    );
    // And the proof in data: the oldest fixture row still counts.
    await expect(countDrivesAwaitingDecision(client, ME)).resolves.toBe(3);
  });

  it("reports zero rather than throwing when the read fails", async () => {
    // Somebody opening their drive log must not get an error page because
    // a badge could not be sized.
    const { client } = fakeAdmin(FIXTURE, { message: "boom" });
    await expect(countDrivesAwaitingDecision(client, ME)).resolves.toBe(0);
  });
});

describe("applyAwaitingDecisionFilter", () => {
  it("is the single filter both the count and the review deck apply", async () => {
    // Shared so the pill's number and the deck's contents cannot disagree.
    // A pill promising five drives that lands on a deck holding none, and
    // bouncing straight back to /mileage, is worse than no pill.
    const { client, queries } = fakeAdmin(FIXTURE);
    await applyAwaitingDecisionFilter(
      client.from("mileage_trips").select("id", { count: "exact", head: true }),
    ).eq("driver_user_id", ME);
    expect(queries[0].calls).toContain(`or:${AWAITING_DECISION_OR}`);
    expect(queries[0].calls).toContain("neq:classification=passenger");
  });
});
