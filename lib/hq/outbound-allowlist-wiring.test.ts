/**
 * The allowlist, exercised through the two real chokepoints.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM lib/hq/outbound-allowlist.test.ts
 *
 * That file proves the rule is right. This one proves the rule is reached.
 * This repository's characteristic failure is a control that is present,
 * correct and never invoked, and the symptom is always a value that reads as
 * "nothing happened yet". A unit test of a decision function passes just as
 * happily when no chokepoint calls it.
 *
 * So every test below calls the REAL exported function, sendEmail() or
 * notify(), with a stubbed `fetch` underneath, and asserts on THE NETWORK
 * CALL: whether a request reached api.resend.com, whether a request reached
 * the tables a push send has to touch. 6.7's third failure mode asks for
 * exactly this shape: "a test that fails on the network call rather than on
 * a mock's expectation. A mock that was never called proves nothing about the
 * code path that constructs a real client."
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 *
 * Real: sendEmail, notify, sendToUser, buildPayload, eventParties,
 * createServiceClient, the supabase-js query builders, the URL each read
 * produces, the Resend request body.
 *
 * Not real: the HTTP layer, and the sandbox regime. Zero sandbox tenants
 * exist on production, so every test that sees one is describing a database
 * state this deployment has never been in. The first test in each pair is the
 * one that describes production as it is today, and it asserts that the
 * message still goes out.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const PROSPECT = "11111111-1111-4111-8111-111111111111";
const REAL_MANAGER = "33333333-3333-4333-8333-333333333333";
const SANDBOX_COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const PROSPECT_EMAIL = "prospect@example.com";
const REAL_EMAIL = "partner@realfirm.com";

type Regime = {
  /** Rows for `companies?sandbox=eq.true`. */
  sandbox: boolean;
  /** Make the tenant read fail, to exercise the fail-closed branch. */
  realmUnreadable?: boolean;
};

let requests: { url: string; method: string }[] = [];

function install(regime: Regime) {
  requests = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ url: href, method });

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url.hostname === "api.resend.com") return json({ id: "resend-message-id" });

    const table = url.pathname.replace("/rest/v1/", "");
    switch (table) {
      case "companies":
        if (regime.realmUnreadable) {
          return json({ message: "connection reset" }, 500);
        }
        return json(regime.sandbox ? [{ id: SANDBOX_COMPANY }] : []);
      case "company_members":
        return json([{ company_id: SANDBOX_COMPANY, user_id: PROSPECT }]);
      case "profiles":
        return json([{ id: PROSPECT, email: PROSPECT_EMAIL }]);
      case "invitations":
        return json([]);
      case "notification_log":
        return json([{ id: "log-row" }]);
      case "device_tokens":
        return json([]);
      default:
        return json([]);
    }
  });
  vi.stubGlobal("fetch", stub);
}

const reached = (fragment: string) =>
  requests.filter((r) => r.url.includes(fragment));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://wiring.test.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "wiring-test-placeholder");
  vi.stubEnv("RESEND_API_KEY", "wiring-test-placeholder");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the transactional-email chokepoint", () => {
  it("sends, on a deployment with no sandbox tenant", async () => {
    // Production as it stands: `select count(*) from companies where sandbox`
    // is 0 on enisnjjbxqaliydepacc. This control must be invisible there, and
    // this is the assertion that says so rather than the PR description.
    install({ sandbox: false });
    const { sendEmail } = await import("@/lib/email/transport");
    const result = await sendEmail({
      to: REAL_EMAIL,
      subject: "Your weekly summary",
      html: "<p>hello</p>",
    });
    expect(result.ok).toBe(true);
    expect(reached("api.resend.com")).toHaveLength(1);
  });

  it("still delivers the prospect's own mail when a sandbox tenant exists", async () => {
    // 6.6, the Email tell: "Emails the prospect triggers and receives must
    // arrive ... Silently sending nothing is itself a tell."
    install({ sandbox: true });
    const { sendEmail } = await import("@/lib/email/transport");
    const result = await sendEmail({
      to: PROSPECT_EMAIL,
      subject: "Your weekly summary",
      html: "<p>hello</p>",
    });
    expect(result.ok).toBe(true);
    expect(reached("api.resend.com")).toHaveLength(1);
  });

  it("drops a message that carries a sandbox address and a real one together", async () => {
    install({ sandbox: true });
    const { sendEmail } = await import("@/lib/email/transport");
    const result = await sendEmail({
      to: REAL_EMAIL,
      cc: PROSPECT_EMAIL,
      subject: "Your weekly summary",
      html: "<p>hello</p>",
    });
    expect(reached("api.resend.com")).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sandbox/i);
  });

  it("drops rather than sends when it cannot read the realm", async () => {
    install({ sandbox: false, realmUnreadable: true });
    const { sendEmail } = await import("@/lib/email/transport");
    const result = await sendEmail({
      to: REAL_EMAIL,
      subject: "Your weekly summary",
      html: "<p>hello</p>",
    });
    expect(reached("api.resend.com")).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it("writes the refusal as one line, whatever the subject contains", async () => {
    /**
     * The [hq-egress] line is the count 6.5 asks for, and an email subject is
     * user-controlled: firm-digest builds one from `firms.name`. A newline in
     * it would forge an entry in the record the Hub operator is pointed at.
     * logSafe() exists for that, and this asserts it is REACHED rather than
     * merely exported.
     */
    install({ sandbox: false, realmUnreadable: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendEmail } = await import("@/lib/email/transport");
    await sendEmail({
      to: REAL_EMAIL,
      subject: "Ridge Tax\n[hq-egress] email sent reason=fine",
      html: "<p>hello</p>",
    });
    const lines = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    const egress = lines.filter((l) => l.includes("[hq-egress]"));
    expect(egress).toHaveLength(1);
    expect(egress[0]).not.toMatch(/[\r\n]/);
  });

  it("refuses rather than throwing when no privileged client can be built", async () => {
    /**
     * sendEmail() is documented as never surfacing an exception, and 13 call
     * sites are written against that. Building a service-role client is the
     * one step in the new screen that can throw before any promise exists:
     * supabase-js raises "Your project's URL and Key are required to create a
     * Supabase client" when the key is absent, which is the state of any
     * environment that has a mailer configured and no service role. That
     * throw would escape sendEmail() and reach a caller that has no catch.
     */
    install({ sandbox: false });
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { sendEmail } = await import("@/lib/email/transport");
    const result = await sendEmail({
      to: REAL_EMAIL,
      subject: "Your weekly summary",
      html: "<p>hello</p>",
    });
    expect(reached("api.resend.com")).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sandbox/i);
  });

  it("does not throw when it drops, because 13 call sites are written against that", async () => {
    install({ sandbox: false, realmUnreadable: true });
    const { sendEmail } = await import("@/lib/email/transport");
    await expect(
      sendEmail({ to: REAL_EMAIL, subject: "s", html: "<p>h</p>" }),
    ).resolves.toBeTruthy();
  });
});

describe("the push chokepoint", () => {
  it("sends, on a deployment with no sandbox tenant", async () => {
    install({ sandbox: false });
    const { notify } = await import("@/lib/push");
    await notify(REAL_MANAGER, { kind: "tracker_stalled", dayKey: "2026-08-22" });
    // The dedupe claim is the first thing a permitted send does.
    expect(reached("notification_log").length).toBeGreaterThan(0);
  });

  it("notifies a prospect about their own drive when a sandbox tenant exists", async () => {
    install({ sandbox: true });
    const { notify } = await import("@/lib/push");
    await notify(PROSPECT, { kind: "tracker_stalled", dayKey: "2026-08-22" });
    expect(reached("notification_log").length).toBeGreaterThan(0);
  });

  it("drops a manager alert about a sandbox driver sent to a manager outside it", async () => {
    // 6.7 failure mode 1, in the exact shape push takes here. The manager
    // alert is the only push in this product addressed to someone other than
    // the person it is about, and the driver it is about rides in the event.
    install({ sandbox: true });
    const { notify } = await import("@/lib/push");
    const result = await notify(REAL_MANAGER, {
      kind: "driver_tracker_unreachable",
      driverLabel: "A driver",
      driverId: PROSPECT,
      dayKey: "2026-08-22",
    });
    expect(reached("notification_log")).toEqual([]);
    expect(reached("device_tokens")).toEqual([]);
    expect(result.delivered).toBe(0);
    expect(result.sent).toBe(false);
  });

  it("drops rather than sends when it cannot read the realm", async () => {
    install({ sandbox: false, realmUnreadable: true });
    const { notify } = await import("@/lib/push");
    const result = await notify(REAL_MANAGER, {
      kind: "tracker_stalled",
      dayKey: "2026-08-22",
    });
    expect(reached("notification_log")).toEqual([]);
    expect(result.sent).toBe(false);
  });

  it("does not throw when it drops, because notify() is fire-and-forget", async () => {
    install({ sandbox: false, realmUnreadable: true });
    const { notify } = await import("@/lib/push");
    await expect(
      notify(REAL_MANAGER, { kind: "tracker_stalled", dayKey: "2026-08-22" }),
    ).resolves.toBeTruthy();
  });
});

describe("the stub is not the thing being tested", () => {
  it("would have let a real Resend request through if nothing screened it", async () => {
    // Guards the shape of every "expect(reached(...)).toEqual([])" above. If
    // the stub simply never served api.resend.com, those assertions would
    // pass with no control in the code at all.
    install({ sandbox: false });
    const res = await fetch("https://api.resend.com/emails", { method: "POST" });
    expect(res.status).toBe(200);
    expect(reached("api.resend.com")).toHaveLength(1);
  });
});
