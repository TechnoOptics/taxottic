/**
 * The outbound recipient allowlist, decided in one place for every egress
 * path that addresses a person.
 *
 * Fleet contract 6.5, transactional email row: "One send function, which
 * drops any message whose recipients are not all on the sandbox allowlist.
 * The allowlist for a sandbox tenant is exactly the prospect's own address,
 * plus any address they invited into their own sandbox tenant. Everything
 * else is dropped and counted, not queued." The next row: "SMS, push, voice:
 * Same rule, same chokepoint shape, same allowlist."
 *
 * "Same allowlist" is why one module serves both chokepoints. Two copies of
 * one rule is the mechanism 6.2 rejects, at a coarser grain: the day the rule
 * changes, one copy changes.
 *
 * WHAT THESE TESTS EXERCISE, AND WHAT THEY CANNOT
 *
 * Every sandbox regime below is supplied by a fake. Zero sandbox tenants
 * exist on production (measured on enisnjjbxqaliydepacc, 2026-08-22:
 * `select count(*) from companies where sandbox` is 0), and nothing in this
 * repository writes a true value into that column, which
 * lib/hq/elevated-call-sites.test.ts holds in place. So the branch that
 * refuses anything has never run against a real row and cannot until
 * provisioning exists. That is the point of the first test: with no sandbox
 * tenant, this control is a no-op, which is what makes it safe to ship ahead
 * of the endpoints.
 */

import { describe, it, expect } from "vitest";
import {
  NO_SANDBOX_TENANTS,
  decideOutbound,
  emailRecipients,
  loadOutboundRealm,
  logSafe,
  screenOutbound,
  type OutboundRealm,
  type OutboundRealmSource,
} from "./outbound-allowlist";

const PROSPECT = "11111111-1111-4111-8111-111111111111";
const INVITEE = "22222222-2222-4222-8222-222222222222";
const REAL_USER = "33333333-3333-4333-8333-333333333333";
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ONE_TENANT: OutboundRealm = {
  tenants: [
    {
      companyId: TENANT_A,
      userIds: [PROSPECT, INVITEE],
      emails: ["prospect@example.com", "colleague@example.com"],
    },
  ],
};

const TWO_TENANTS: OutboundRealm = {
  tenants: [
    ...ONE_TENANT.tenants,
    {
      companyId: TENANT_B,
      userIds: [REAL_USER],
      emails: ["other-prospect@example.net"],
    },
  ],
};

describe("the decision, with no sandbox tenant in existence", () => {
  it("allows a message to anyone", () => {
    const decision = decideOutbound(
      [
        { kind: "user", id: REAL_USER },
        { kind: "email", address: "client@realfirm.com" },
      ],
      NO_SANDBOX_TENANTS,
    );
    expect(decision.allowed).toBe(true);
  });

  it("says why, so a log line reads as a decision and not as an accident", () => {
    const decision = decideOutbound([{ kind: "user", id: REAL_USER }], NO_SANDBOX_TENANTS);
    expect(decision.reason).toMatch(/no sandbox tenant/i);
  });
});

describe("the decision, with a sandbox tenant present", () => {
  it("allows a message that reaches nobody inside it", () => {
    const decision = decideOutbound(
      [
        { kind: "user", id: REAL_USER },
        { kind: "email", address: "client@realfirm.com" },
      ],
      ONE_TENANT,
    );
    expect(decision.allowed).toBe(true);
  });

  it("allows a message to the prospect", () => {
    const decision = decideOutbound(
      [{ kind: "email", address: "prospect@example.com" }],
      ONE_TENANT,
    );
    expect(decision.allowed).toBe(true);
  });

  it("allows a push to the prospect's own user id", () => {
    const decision = decideOutbound([{ kind: "user", id: PROSPECT }], ONE_TENANT);
    expect(decision.allowed).toBe(true);
  });

  it("allows a message to someone the prospect invited into their own tenant", () => {
    const decision = decideOutbound(
      [
        { kind: "email", address: "prospect@example.com" },
        { kind: "email", address: "colleague@example.com" },
      ],
      ONE_TENANT,
    );
    expect(decision.allowed).toBe(true);
  });

  it("matches an address whatever case it was typed in", () => {
    // Not cosmetic. If the fold is missing, "Prospect@Example.com" reads as
    // outside the tenant, and the next assertion in this file, the mixed
    // audience, passes for the wrong reason: it would block because it
    // thought BOTH recipients were outside, which is the allow branch.
    const decision = decideOutbound(
      [
        { kind: "email", address: "  Prospect@Example.COM " },
        { kind: "email", address: "client@realfirm.com" },
      ],
      ONE_TENANT,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/outside/i);
  });

  it("blocks a message that reaches a sandbox member and someone outside", () => {
    const decision = decideOutbound(
      [
        { kind: "email", address: "prospect@example.com" },
        { kind: "email", address: "client@realfirm.com" },
      ],
      ONE_TENANT,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/outside/i);
  });

  it("blocks a push to a sandbox user carried alongside a real one", () => {
    const decision = decideOutbound(
      [
        { kind: "user", id: PROSPECT },
        { kind: "user", id: REAL_USER },
      ],
      ONE_TENANT,
    );
    expect(decision.allowed).toBe(false);
  });

  it("blocks a message that spans two sandbox tenants", () => {
    const decision = decideOutbound(
      [
        { kind: "email", address: "prospect@example.com" },
        { kind: "email", address: "other-prospect@example.net" },
      ],
      TWO_TENANTS,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/two sandbox tenants|more than one/i);
  });

  it("blocks a recipient who somehow holds membership in two sandbox tenants", () => {
    // The boundary migration asserts provisioning never creates a user with
    // memberships on both sides. This is the same invariant one level down:
    // if it is ever broken, the allowlist has no single tenant to check
    // against, so it refuses rather than picking one.
    const crossed: OutboundRealm = {
      tenants: [
        { companyId: TENANT_A, userIds: [PROSPECT], emails: [] },
        { companyId: TENANT_B, userIds: [PROSPECT], emails: [] },
      ],
    };
    const decision = decideOutbound([{ kind: "user", id: PROSPECT }], crossed);
    expect(decision.allowed).toBe(false);
  });
});

describe("a message's recipients are every address it reaches, not just the To", () => {
  it("carries the To", () => {
    expect(emailRecipients({ to: "a@example.com" })).toEqual([
      { kind: "email", address: "a@example.com" },
    ]);
  });

  it("carries a single Cc", () => {
    expect(emailRecipients({ to: "a@example.com", cc: "b@example.com" })).toEqual([
      { kind: "email", address: "a@example.com" },
      { kind: "email", address: "b@example.com" },
    ]);
  });

  it("carries every Cc in a list", () => {
    // 6.5 says "any message whose recipients are not ALL on the allowlist".
    // A Cc that skipped the screen is a recipient outside it.
    expect(
      emailRecipients({
        to: "a@example.com",
        cc: ["b@example.com", "c@example.com"],
      }).length,
    ).toBe(3);
  });
});

// ---------------------------------------------------------------------------

type FakeRow = Record<string, unknown>;

/**
 * A stand-in for a PostgREST client, recording which tables it was asked for.
 *
 * `queried` is how the cheap-path test shows that a deployment with no
 * sandbox tenant pays exactly one round trip per message rather than four.
 */
function fakeSource(
  tables: Record<string, FakeRow[]>,
  errors: Record<string, string> = {},
): OutboundRealmSource & { queried: string[] } {
  const queried: string[] = [];
  const source = {
    queried,
    from(table: string) {
      queried.push(table);
      const result = errors[table]
        ? { data: null, error: { message: errors[table] } }
        : { data: tables[table] ?? [], error: null };
      const chain = {
        select: () => chain,
        eq: () => Promise.resolve(result),
        in: () => Promise.resolve(result),
      };
      return chain;
    },
  };
  return source as unknown as OutboundRealmSource & { queried: string[] };
}

describe("reading the realm", () => {
  it("asks one question when no sandbox tenant exists", async () => {
    const db = fakeSource({ companies: [] });
    const realm = await loadOutboundRealm(db);
    expect(realm.tenants).toEqual([]);
    expect(db.queried).toEqual(["companies"]);
  });

  it("groups members, their addresses and their pending invitations by tenant", async () => {
    const db = fakeSource({
      companies: [{ id: TENANT_A }],
      company_members: [
        { company_id: TENANT_A, user_id: PROSPECT },
        { company_id: TENANT_A, user_id: INVITEE },
      ],
      profiles: [
        { id: PROSPECT, email: "Prospect@Example.com" },
        { id: INVITEE, email: "colleague@example.com" },
      ],
      invitations: [{ company_id: TENANT_A, email: "NotYet@Example.com" }],
    });
    const realm = await loadOutboundRealm(db);
    expect(realm.tenants).toHaveLength(1);
    expect([...realm.tenants[0].userIds].sort()).toEqual([PROSPECT, INVITEE].sort());
    expect([...realm.tenants[0].emails].sort()).toEqual([
      "colleague@example.com",
      "notyet@example.com",
      "prospect@example.com",
    ]);
  });

  it("throws when it cannot read which tenants are sandboxes", async () => {
    const db = fakeSource({}, { companies: "connection reset" });
    await expect(loadOutboundRealm(db)).rejects.toThrow(/connection reset/);
  });

  it("throws when it cannot read who is inside them", async () => {
    const db = fakeSource(
      { companies: [{ id: TENANT_A }] },
      { company_members: "statement timeout" },
    );
    await expect(loadOutboundRealm(db)).rejects.toThrow(/statement timeout/);
  });
});

describe("what reaches a log line", () => {
  /**
   * The [hq-egress] line is the count 6.5 asks for, so it has to be a line.
   * An email subject is user-controlled here (firm-digest builds one from
   * `firms.name`), and a newline inside it would forge an entry in the record
   * the Hub operator is pointed at.
   */
  it("keeps a forged line out of the record", () => {
    expect(logSafe('Acme\n[hq-egress] email sent reason=fine')).not.toMatch(/\n/);
  });

  it("keeps a carriage return out too", () => {
    expect(logSafe("Acme\r\nInjected")).not.toMatch(/[\r\n]/);
  });

  it("bounds the length, so one subject cannot flood the record", () => {
    expect(logSafe("x".repeat(500)).length).toBeLessThanOrEqual(140);
  });

  it("leaves an ordinary subject readable", () => {
    expect(logSafe("Ridge Tax, today's summary (4 updates)")).toBe(
      "Ridge Tax, today's summary (4 updates)",
    );
  });
});

describe("the screen a chokepoint calls", () => {
  it("allows the message when the realm reads clean and holds no sandbox tenant", async () => {
    const decision = await screenOutbound(
      [{ kind: "email", address: "client@realfirm.com" }],
      () => fakeSource({ companies: [] }),
    );
    expect(decision.allowed).toBe(true);
  });

  it("refuses the message when the realm cannot be read", async () => {
    // Fail closed. The alternative is sending unscreened, which is an open
    // boundary that looks like a working product.
    const decision = await screenOutbound(
      [{ kind: "email", address: "client@realfirm.com" }],
      () => fakeSource({}, { companies: "connection reset" }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/connection reset/);
  });

  it("never throws, because both chokepoints are best-effort and must not become an outage", async () => {
    await expect(
      screenOutbound([{ kind: "user", id: REAL_USER }], () => fakeSource({}, { companies: "boom" })),
    ).resolves.toBeTruthy();
  });
});
