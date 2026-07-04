/**
 * Universal outbound email transport.
 *
 * One function, two backends. The first one configured wins:
 *   1. Resend (REST API, no SDK dependency). Used in production.
 *      Provides per-firm from-addresses, HTML + plain-text, and
 *      reply-to.
 *   2. Supabase auth-OTP magic-link. Used in dev / when
 *      RESEND_API_KEY is unset. We construct a sign-in link and
 *      let Supabase's email provider deliver it. Limitation: only
 *      magic-link emails; the subject + template are controlled
 *      in the Supabase dashboard, not per-message.
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

import { createServiceClient } from "@/lib/supabase/server";

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
  /** "resend" | "supabase-otp" | "noop" */
  provider: "resend" | "supabase-otp" | "noop";
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
 * Send a transactional email via the first configured provider.
 * Returns ok=true on first success; on failure it doesn't fall
 * through to the OTP path automatically because the OTP path
 * sends magic-links (different content). Use sendMagicLinkEmail
 * below explicitly when you want OTP semantics.
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

/**
 * Send a sign-in magic link via Supabase OTP. Kept for the existing
 * firm-invitation flow that wants the link to verify the email +
 * create the user in one click. New callers should prefer sendEmail
 * with an explicit body.
 */
export async function sendMagicLinkEmail(args: {
  email: string;
  redirectTo: string;
}): Promise<SendEmailResult> {
  try {
    const admin = createServiceClient();
    const { error } = await admin.auth.signInWithOtp({
      email: args.email,
      options: {
        emailRedirectTo: args.redirectTo,
        shouldCreateUser: true,
      },
    });
    if (error) {
      return {
        ok: false,
        reason: error.message,
        provider: "supabase-otp",
      };
    }
    return { ok: true, provider: "supabase-otp" };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
      provider: "supabase-otp",
    };
  }
}
