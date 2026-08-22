/**
 * The second transactional-email exit, held shut while it is ungated.
 *
 * Fleet contract 6.5 requires ONE chokepoint per egress path, carrying the
 * sandbox allowlist. This product has TWO exits for transactional email:
 *
 *   lib/email/transport.ts        sendEmail() -> Resend REST. 13 call sites.
 *   lib/email/send-firm-invite.ts signInWithOtp -> Supabase's own mailer.
 *
 * The second cannot carry the allowlist. Its body and subject are templated
 * in the Supabase dashboard rather than in this repository, so neither the
 * recipient screen in 6.5 nor the invisibility sweep in 6.6 can see it, and
 * routing it through sendEmail() would change what a real firm owner receives
 * today. 6.3 names the remaining option for a path that cannot be bound:
 * "sequence it before the first sandbox tenant exists".
 *
 * That is what these tests pin. The gate asks the database whether any
 * sandbox tenant exists, and refuses to dispatch if one does or if it cannot
 * tell. Today the answer is the empty set, so the send behaves exactly as it
 * did before, which is the first test below. The other two are the regime
 * this path must not operate in.
 */

import { describe, it, expect } from "vitest";
import { sendFirmInviteMagicLink } from "./send-firm-invite";

type AdminArg = Parameters<typeof sendFirmInviteMagicLink>[0];

/**
 * A stand-in for the privileged client the caller passes in.
 *
 * `signInWithOtp` throws rather than recording a call. A test that asserts
 * "the mock was not called" passes just as happily when the import broke, so
 * the refusal tests below assert on the reason the real function returned,
 * and the throw is what turns a missing gate into a visibly different reason
 * rather than a silent success.
 */
function fakeAdmin(rpcResult: { data: unknown; error: unknown }) {
  const state = { dispatched: 0 };
  const admin = {
    rpc: async (name: string) => {
      if (name !== "hq_sandbox_company_ids") {
        throw new Error(`unexpected rpc: ${name}`);
      }
      return rpcResult;
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
  invitePath: "/invite/abc123",
  destinationOrigin: "https://enterprise.taxottic.com",
};

describe("the firm-invite magic link, while no sandbox tenant exists", () => {
  it("still dispatches, so today's behaviour is unchanged", async () => {
    const { admin, state } = fakeAdmin({ data: [], error: null });
    const result = await sendFirmInviteMagicLink(admin, ARGS);
    // The stub throws on dispatch, so reaching the mailer is what we assert:
    // the gate let it through and the transport was the thing that failed.
    expect(state.dispatched).toBe(1);
    expect(result.reason).toMatch(/DISPATCHED/);
    expect(result.inviteUrl).toBe(
      "https://enterprise.taxottic.com/invite/abc123",
    );
  });
});

describe("the firm-invite magic link, once a sandbox tenant exists", () => {
  it("refuses to reach the mailer at all", async () => {
    const { admin, state } = fakeAdmin({
      data: ["0f5a1f9e-0000-4000-8000-000000000001"],
      error: null,
    });
    const result = await sendFirmInviteMagicLink(admin, ARGS);
    expect(state.dispatched).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sandbox/i);
    // The URL still comes back so the caller's manual-handoff path works.
    expect(result.inviteUrl).toBe(
      "https://enterprise.taxottic.com/invite/abc123",
    );
  });

  it("refuses when it cannot tell, rather than assuming there is none", async () => {
    const { admin, state } = fakeAdmin({
      data: null,
      error: { message: "function public.hq_sandbox_company_ids() not found" },
    });
    const result = await sendFirmInviteMagicLink(admin, ARGS);
    expect(state.dispatched).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sandbox/i);
  });
});
