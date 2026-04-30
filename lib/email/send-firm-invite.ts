/**
 * Outbound email for firm invitations.
 *
 * We piggyback on Supabase's built-in auth-email infrastructure
 * instead of standing up Resend / SES today. The trick:
 *   - supabase.auth.signInWithOtp({ email, options: { emailRedirectTo,
 *     shouldCreateUser: true } }) sends a magic-link email through
 *     Supabase's email provider with templating they already manage.
 *   - We set emailRedirectTo to point at the enterprise app's auth
 *     callback with a `next` param that lands the user on
 *     /invite/<token>. After verifying the magic link, the user is
 *     signed in AND on the invitation acceptance page in one click.
 *
 * Trade-off vs Resend: Supabase auth emails are templated by Supabase
 * (subject/body controlled in the dashboard, not per-message). For a
 * v1 onboarding flow that's fine. When we want richer transactional
 * email (per-firm branding, audit alerts) we swap to Resend without
 * touching the call sites because the export contract here stays the
 * same.
 *
 * Pre-requisite: the enterprise app's domain must be on Supabase's
 * Allowed Redirect URLs list in Auth > URL Configuration. Without it,
 * the email goes out but the link bounces back to the project's
 * default site URL.
 */

import { createServiceClient } from "@/lib/supabase/server";

type Provider = ReturnType<typeof createServiceClient>;

type SendArgs = {
  email: string;
  /** The /invite/<token> path on the destination app */
  invitePath: string;
  /** Origin for the destination app, e.g. https://enterprise.taxottic.com */
  destinationOrigin: string;
};

type Result = {
  ok: boolean;
  /** When ok=false, a friendly message we can surface to the super-admin */
  reason?: string;
  /** When ok=true, the URL we asked Supabase to email */
  inviteUrl?: string;
};

/**
 * Sends a magic-link email to `email` that, when clicked, lands the
 * user on the destination app's invite acceptance page. Returns ok+url
 * on success; on failure surfaces a reason so the caller can fall back
 * to logging the URL for manual handoff.
 */
export async function sendFirmInviteMagicLink(
  admin: Provider,
  args: SendArgs,
): Promise<Result> {
  const { email, invitePath, destinationOrigin } = args;
  const cleanOrigin = destinationOrigin.replace(/\/$/, "");
  const inviteUrl = `${cleanOrigin}${invitePath}`;
  const callbackUrl = `${cleanOrigin}/auth/callback?next=${encodeURIComponent(invitePath)}`;

  // signInWithOtp via the admin client. This is a normal client call
  // under the service-role hood; supabase-js handles the email send.
  // shouldCreateUser=true so users without prior Taxottic accounts
  // are minted on the first click.
  try {
    const { error } = await admin.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl,
        shouldCreateUser: true,
      },
    });
    if (error) {
      return {
        ok: false,
        reason: error.message,
        inviteUrl,
      };
    }
    return { ok: true, inviteUrl };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Unknown email error",
      inviteUrl,
    };
  }
}

/**
 * Resolves the right destination origin for an enterprise-app invite.
 * Reads ENTERPRISE_SITE_URL from env if present; otherwise falls back
 * to a sensible default.
 */
export function enterpriseSiteOrigin(): string {
  const fromEnv = process.env.ENTERPRISE_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "https://enterprise.taxottic.com";
}
