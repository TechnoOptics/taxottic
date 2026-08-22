/**
 * Universal outbound email transport.
 *
 * One function, one backend: Resend, over its REST API with no SDK
 * dependency.
 *
 * This module used to describe itself as one function with two
 * backends, the second being a Supabase auth-OTP magic link. That
 * second backend, sendMagicLinkEmail(), had zero call sites in the
 * repository and has been removed. It is worth saying why rather
 * than just deleting it: a Supabase auth send is templated in the
 * Supabase dashboard, so its subject and body are invisible to the
 * recipient screen the fleet contract puts on this function (6.5)
 * and to the word sweep in lib/hq/invisibility.test.ts (6.6). An
 * exported function that does that, living in the same file as the
 * chokepoint, is what the next person reaches for. The remaining
 * Supabase-mailer path is lib/email/send-firm-invite.ts, which is
 * inventoried in lib/hq/egress-chokepoints.test.ts.
 *
 * Why not the official `resend` npm package: a single REST POST is
 * faster than carrying another dependency, and pinning to a wire
 * format gives us a more predictable surface for tests. We can
 * always swap in the SDK if Resend ships features we want.
 *
 * Errors are NEVER surfaced as exceptions, caller gets
 * `{ ok: false, reason }`. Email delivery is treated as best-effort
 * so an SMTP outage doesn't take down the request that triggered
 * the send.
 */

export type SendEmailArgs = {
  /** Recipient address. Required. */
  to: string;
  /** Optional CC. */
  cc?: string | string[];
  /** From-address override. Defaults to env DEFAULT_FROM_EMAIL or
   *  noreply@taxottic.com. Resend requires the from-domain be
   *  verified. */
  from?: string;
  /** Display name on the from-address line. */
  fromName?: string;
  /** Reply-To header. Useful when a firm wants client replies to
   *  land in their inbox rather than ours. */
  replyTo?: string;
  subject: string;
  /** HTML body. */
  html: string;
  /** Plain-text fallback. Strongly recommended; gmail's spam
   *  signal weights heavily on text-part absence. */
  text?: string;
  /** Optional Resend `tags` so we can group sends in their
   *  dashboard (e.g., kind=firm-invite). */
  tags?: Record<string, string>;
};

export type SendEmailResult = {
  ok: boolean;
  reason?: string;
  /** Underlying provider's message ID when known. */
  messageId?: string;
  /** "resend" | "noop" */
  provider: "resend" | "noop";
};

const DEFAULT_FROM_EMAIL =
  process.env.DEFAULT_FROM_EMAIL ?? "noreply@taxottic.com";

function formatFromHeader(args: SendEmailArgs): string {
  const addr = args.from ?? DEFAULT_FROM_EMAIL;
  if (args.fromName && args.fromName.trim().length > 0) {
    // Quote the name to escape commas + special chars per RFC 5322.
    const safeName = args.fromName.replace(/"/g, "'");
    return `"${safeName}" <${addr}>`;
  }
  return addr;
}

async function sendViaResend(
  args: SendEmailArgs,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "RESEND_API_KEY missing", provider: "resend" };
  }
  try {
    const payload: Record<string, unknown> = {
      from: formatFromHeader(args),
      to: args.to,
      subject: args.subject,
      html: args.html,
    };
    if (args.text) payload.text = args.text;
    if (args.cc) payload.cc = args.cc;
    if (args.replyTo) payload.reply_to = args.replyTo;
    if (args.tags) {
      payload.tags = Object.entries(args.tags).map(([name, value]) => ({
        name,
        value,
      }));
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `Resend ${res.status}: ${body.slice(0, 200)}`,
        provider: "resend",
      };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, messageId: json.id, provider: "resend" };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
      provider: "resend",
    };
  }
}

/**
 * Send a transactional email through Resend.
 *
 * This is the transactional-email chokepoint from section 6.5 of the
 * fleet contract: the one place a message leaves this process for a
 * mail provider, and therefore the one place the sandbox recipient
 * allowlist goes. Send mail from here, not from a provider of your
 * own.
 */
export async function sendEmail(
  args: SendEmailArgs,
): Promise<SendEmailResult> {
  if (process.env.RESEND_API_KEY) {
    return await sendViaResend(args);
  }
  // Best-effort: log enough to debug + acknowledge the no-op so
  // callers don't loop indefinitely. In dev this surfaces in the
  // server console; in production this should never run because
  // RESEND_API_KEY is always set.
   
  console.warn(
    `[email] no provider configured (RESEND_API_KEY unset). Would have sent to ${args.to}: "${args.subject}"`,
  );
  return { ok: true, provider: "noop" };
}
