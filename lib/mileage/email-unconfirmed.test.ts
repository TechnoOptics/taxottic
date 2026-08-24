/**
 * The sweep, tested at the call site rather than through its pure parts.
 *
 * unconfirmed-drives.test.ts already proves the cadence arithmetic. What
 * it cannot prove is that the caller feeds it the right fields and
 * stamps the throttle only for messages that genuinely left. Both of
 * those have been wrong here before:
 *
 *   - the caller selected started_at and never ended_at, so the settle
 *     window had nothing to measure from;
 *   - the caller read `ok` alone, and sendEmail() returns
 *     `{ ok: true, provider: "noop" }` when RESEND_API_KEY is unset. A
 *     no-op therefore stamped confirmation_reminded_at and silenced the
 *     driver for the next window on the strength of a message nobody
 *     sent. The stamp is the only evidence in production that these
 *     reminders are real, so a no-op that stamps destroys the evidence
 *     as well as the reminder.
 */

import { describe, expect, it } from "vitest";
import type { SendEmailResult } from "@/lib/email/transport";
import { emailUnconfirmedDrives, type EmailSender } from "./email-unconfirmed";

const NOW = Date.parse("2026-08-24T18:00:00Z");
const HOUR = 3_600_000;

type TripRow = {
  id: string;
  driver_user_id: string;
  started_at: string;
  ended_at: string | null;
  distance_miles: number;
  confirmation_reminded_at: string | null;
  start_place: null;
  end_place: null;
};

type Stamp = { ids: string[]; values: Record<string, unknown> };

/**
 * The narrowest Supabase stand-in that exercises the real query chain:
 * one select on mileage_trips, one on profiles, and an update whose
 * arguments are recorded so the test can assert on what was stamped.
 */
function fakeAdmin(opts: {
  trips: TripRow[];
  selectColumns?: { value: string };
  stamps: Stamp[];
}) {
  return {
    from(table: string) {
      if (table === "mileage_trips") {
        return {
          select(cols: string) {
            if (opts.selectColumns) opts.selectColumns.value = cols;
            return {
              eq: async () => ({ data: opts.trips, error: null }),
            };
          },
          update(values: Record<string, unknown>) {
            return {
              in: async (_col: string, ids: string[]) => {
                opts.stamps.push({ ids, values });
                return { data: null, error: null };
              },
            };
          },
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { id: "abel", full_name: "Abel Ark", email: "abel@example.com" },
              ],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function trip(over: Partial<TripRow> = {}): TripRow {
  return {
    id: "t1",
    driver_user_id: "abel",
    started_at: new Date(NOW - 3 * HOUR).toISOString(),
    ended_at: new Date(NOW - 2 * HOUR).toISOString(),
    distance_miles: 12.4,
    confirmation_reminded_at: null,
    start_place: null,
    end_place: null,
    ...over,
  };
}

const sender = (result: SendEmailResult): { send: EmailSender; calls: number[] } => {
  const calls: number[] = [];
  return {
    calls,
    send: async () => {
      calls.push(1);
      return result;
    },
  };
};

describe("stamping only follows a real dispatch", () => {
  it("does not stamp when the transport had no provider behind it", async () => {
    const stamps: Stamp[] = [];
    const { send, calls } = sender({ ok: true, provider: "noop" });
    const out = await emailUnconfirmedDrives(
      fakeAdmin({ trips: [trip()], stamps }),
      NOW,
      send,
    );
    expect(calls).toHaveLength(1);
    expect(out.noopSkipped).toBe(1);
    expect(out.emailed, "a no-op is not an email").toBe(0);
    expect(
      stamps,
      "stamping a no-op silences the driver for a message that never left",
    ).toEqual([]);
  });

  it("does not stamp when the egress allowlist refuses the message", async () => {
    const stamps: Stamp[] = [];
    const { send } = sender({
      ok: false,
      reason: "sandbox egress: mixed realms",
      provider: "blocked",
    });
    const out = await emailUnconfirmedDrives(
      fakeAdmin({ trips: [trip()], stamps }),
      NOW,
      send,
    );
    expect(out.failed).toBe(1);
    expect(stamps).toEqual([]);
  });

  it("stamps every drive named in the message once it really sent", async () => {
    const stamps: Stamp[] = [];
    const { send } = sender({ ok: true, provider: "resend", messageId: "m1" });
    const out = await emailUnconfirmedDrives(
      fakeAdmin({
        trips: [trip({ id: "a" }), trip({ id: "b" })],
        stamps,
      }),
      NOW,
      send,
    );
    expect(out.emailed).toBe(1);
    expect(out.noopSkipped).toBe(0);
    expect(stamps).toHaveLength(1);
    expect(new Set(stamps[0].ids)).toEqual(new Set(["a", "b"]));
    expect(stamps[0].values.confirmation_reminded_at).toBe(
      new Date(NOW).toISOString(),
    );
  });
});

describe("the caller feeds the cadence what it needs", () => {
  it("selects ended_at, which the settle window measures from", async () => {
    const selectColumns = { value: "" };
    const { send } = sender({ ok: true, provider: "resend" });
    await emailUnconfirmedDrives(
      fakeAdmin({ trips: [trip()], selectColumns, stamps: [] }),
      NOW,
      send,
    );
    expect(
      selectColumns.value,
      "without ended_at every drive reads as un-ripe and nobody is ever told",
    ).toContain("ended_at");
  });

  it("holds back a drive that has not settled yet", async () => {
    const stamps: Stamp[] = [];
    const { send, calls } = sender({ ok: true, provider: "resend" });
    const out = await emailUnconfirmedDrives(
      fakeAdmin({
        trips: [trip({ ended_at: new Date(NOW - 5 * 60_000).toISOString() })],
        stamps,
      }),
      NOW,
      send,
    );
    expect(calls).toEqual([]);
    expect(out.driversWithPending).toBe(1);
    expect(out.emailed).toBe(0);
  });

  it("tells the driver about a drive that ended an hour ago", async () => {
    // The whole point of the 2026-08-24 change. Before it, this drive
    // waited 24 hours for the quiet period and then as long again for
    // the backlog's three-day anniversary.
    const { send, calls } = sender({ ok: true, provider: "resend" });
    const out = await emailUnconfirmedDrives(
      fakeAdmin({
        trips: [
          trip({
            id: "fresh",
            ended_at: new Date(NOW - HOUR).toISOString(),
            confirmation_reminded_at: null,
          }),
          trip({
            id: "backlog",
            started_at: new Date(NOW - 20 * 24 * HOUR).toISOString(),
            ended_at: new Date(NOW - 20 * 24 * HOUR + HOUR).toISOString(),
            confirmation_reminded_at: new Date(NOW - 8 * HOUR).toISOString(),
          }),
        ],
        stamps: [],
      }),
      NOW,
      send,
    );
    expect(calls).toHaveLength(1);
    expect(out.emailed).toBe(1);
  });

  it("falls back to started_at rather than dropping a drive with no end", async () => {
    const { send, calls } = sender({ ok: true, provider: "resend" });
    await emailUnconfirmedDrives(
      fakeAdmin({ trips: [trip({ ended_at: null })], stamps: [] }),
      NOW,
      send,
    );
    expect(calls).toHaveLength(1);
  });
});
