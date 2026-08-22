/**
 * The second transactional-email exit, and the one invite it may refuse.
 *
 * Fleet contract 6.5 requires ONE chokepoint per egress path, carrying the
 * sandbox allowlist. This product has TWO exits for transactional email:
 *
 *   lib/email/transport.ts        sendEmail() -> Resend REST. 13 call sites.
 *   lib/email/send-firm-invite.ts signInWithOtp -> Supabase's own mailer.
 *
 * The second cannot carry the allowlist. Its body and subject are templated
 * in the Supabase dashboard rather than in this repository, so neither the
 * recipient screen in 6.5 nor the word sweep in 6.6 can see it, and routing
 * it through sendEmail() would change what a real firm owner receives today.
 * 6.3 names the remaining option for a path that cannot be bound: "sequence
 * it before the first sandbox tenant exists".
 *
 * WHY THE REFUSAL IS PER-INVITE AND NOT PER-DEPLOYMENT
 *
 * The first version of this gate refused whenever ANY sandbox tenant existed
 * anywhere. That is the wrong trade. Firm invites address firms, `firms`
 * carries no company_id and no sandbox column, and the only join from a firm
 * to a company is firm_engagements. A deployment-wide refusal would stop
 * every real firm's invitation on the day Techno Optics provisions its first
 * prospect, to prevent something the firm axis already prevents, and it would
 * stop it quietly: the caller logs `ok: false` to the server console.
 *
 * So the question the gate asks is about THIS invitation. The token in
 * invitePath names a firm_invitations row, that row names a firm, and the
 * firm is sandbox-linked only if one of its engagements points at a sandbox
 * company. Everything else sends.
 *
 * WHAT THESE TESTS CANNOT SHOW
 *
 * Zero sandbox tenants exist in production, so the refusal has never run
 * against a real one. The sandbox regime here is supplied by the fake below.
 * Worth stating too: both real call sites in app/admin/firms/actions.ts
 * INSERT the firm three statements before inviting its owner, so the firm has
 * no engagements yet and cannot be sandbox-linked. The refusal is a tripwire
 * for a caller that invites into an existing firm, which is the shape a
 * provisioning path would have, not a branch today's callers can reach.
 */

import { describe, it, expect } from "vitest";
import { sendFirmInviteMagicLink } from "./send-firm-invite";

type AdminArg = Parameters<typeof sendFirmInviteMagicLink>[0];

type FakeOpts = {
  /** What hq_sandbox_company_ids() returns. */
  sandboxIds?: unknown;
  sandboxError?: unknown;
  /** The firm_invitations row the token resolves to, or null for missing. */
  invitation?: { firm_id: string } | null;
  invitationError?: unknown;
  /** Engagements of that firm pointing at one of the sandbox companies. */
  sandboxEngagements?: { id: string }[];
  engagementError?: unknown;
};

/**
 * A stand-in for the privileged client the caller passes in.
 *
 * `signInWithOtp` throws rather than recording a call. A test that asserts
 * "the mock was not called" passes just as happily when the import broke, so
 * the refusal tests assert on the reason the real function returned, and the
 * throw is what turns a missing gate into a visibly different reason rather
 * than a silent success.
 *
 * `queried` records which tables were read, which is how the first test shows
 * that the common path costs one round trip and not three.
 */
function fakeAdmin(opts: FakeOpts) {
  const state = { dispatched: 0, queried: [] as string[] };

  function builder(table: string) {
    const result =
      table === "firm_invitations"
        ? { data: opts.invitation ?? null, error: opts.invitationError ?? null }
        : {
            data: opts.sandboxEngagements ?? [],
            error: opts.engagementError ?? null,
          };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      limit: () => chain,
      maybeSingle: async () => result,
      // Thenable, so `await` on the chain resolves like a PostgREST builder.
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  const admin = {
    rpc: async (name: string) => {
      if (name !== "hq_sandbox_company_ids") {
        throw new Error(`unexpected rpc: ${name}`);
      }
      state.queried.push("rpc:hq_sandbox_company_ids");
      return { data: opts.sandboxIds ?? [], error: opts.sandboxError ?? null };
    },
    from: (table: string) => {
      state.queried.push(table);
      return builder(table);
    },
    auth: {
      signInWithOtp: async () => {
        state.dispatched++;
        throw new Error("DISPATCHED: a message left through Supabase's mailer");
      },
    },
  };
  return { admin: admin as unknown as AdminArg, state };
}

const ARGS = {
  email: "owner@examplefirm.test",
  invitePath: "/invite/tok_abc123",
  destinationOrigin: "https://enterprise.taxottic.com",
};
const INVITE_URL = "https://enterprise.taxottic.com/invite/tok_abc123";
const SANDBOX_COMPANY = "0f5a1f9e-0000-4000-8000-000000000001";

describe("the firm-invite magic link, while no sandbox tenant exists", () => {
  it("still dispatches, so today's behaviour is unchanged", async () => {
    const { admin, state } = fakeAdmin({ sandboxIds: [] });
    const result = await sendFirmInviteMagicLink(admin, ARGS);
    // The stub throws on dispatch, so reaching the mailer is what we assert:
    // the gate let it through and the transport was the thing that failed.
    expect(state.dispatched).toBe(1);
    expect(result.reason).toMatch(/DISPATCHED/);
    expect(result.inviteUrl).toBe(INVITE_URL);
  });

  it("costs one round trip, not three", async () => {
    // The invitation and engagement lookups exist to answer "is THIS firm
    // sandbox-linked". With no sandbox company to link to there is nothing to
    // ask, and a live product should not pay for the question.
    const { admin, state } = fakeAdmin({ sandboxIds: [] });
    await sendFirmInviteMagicLink(admin, ARGS);
    expect(state.queried).toEqual(["rpc:hq_sandbox_company_ids"]);
  });
});

describe("the firm-invite magic link, once a sandbox tenant exists", () => {
  it("still dispatches for a firm with no sandbox engagement", async () => {
    // The reason this gate is per-invite. On the day Techno Optics provisions
    // its first prospect, every real firm's invitation must still go out.
    const { admin, state } = fakeAdmin({
      sandboxIds: [SANDBOX_COMPANY],
      invitation: { firm_id: "firm-real-1" },
      sandboxEngagements: [],
    });
    const result = await sendFirmInviteMagicLink(admin, ARGS);
    expect(state.dispatched).toBe(1);
    expect(result.reason).toMatch(/DISPATCHED/);
    expect(state.queried).toEqual([
      "rpc:hq_sandbox_company_ids",
      "firm_invitations",
      "firm_engagements",
    ]);
  });

  it("refuses to reach the mailer for a sandbox-linked firm", async () => {
    const { admin, state } = fakeAdmin({
      sandboxIds: [SANDBOX_COMPANY],
      invitation: { firm_id: "firm-sandboxed" },
      sandboxEngagements: [{ id: "eng-1" }],
    });
    const result = await sendFirmInviteMagicLink(admin, ARGS);
    expect(state.dispatched).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sandbox/i);
    // The URL still comes back so the caller's manual-handoff path works.
    expect(result.inviteUrl).toBe(INVITE_URL);
  });

  it("refuses when it cannot tell which firm the invite belongs to", async () => {
    const { admin, state } = fakeAdmin({
      sandboxIds: [SANDBOX_COMPANY],
      invitation: null,
    });
    const result = await sendFirmInviteMagicLink(admin, ARGS);
    expect(state.dispatched).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sandbox/i);
  });
});

describe("the firm-invite magic link, when the boundary is unreadable", () => {
  it("refuses rather than assuming there is no sandbox tenant", async () => {
    const { admin, state } = fakeAdmin({
      sandboxIds: null,
      sandboxError: {
        message: "function public.hq_sandbox_company_ids() not found",
      },
    });
    const result = await sendFirmInviteMagicLink(admin, ARGS);
    expect(state.dispatched).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sandbox/i);
  });
});
