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

  // Fleet contract 6.5: every path out needs one chokepoint that knows about
  // the tenant flag. This path cannot BE that chokepoint. Its subject and
  // body live in the Supabase dashboard rather than in this repository, so
  // the recipient screen 6.5 asks for and the word sweep 6.6 asks for both
  // run somewhere this message never passes through.
  //
  // 6.3 gives the option that applies to a path which cannot be bound:
  // "report the gap to the Hub operator as an open boundary and sequence it
  // before the first sandbox tenant exists". So this asks the database
  // whether one exists, and refuses if the answer is yes or unreadable.
  //
  // hq_sandbox_company_ids() is the security-definer set function created by
  // 20260819010000_hq_sandbox_boundary.sql. It returns the sandbox tenants
  // and nothing else, and it is executable by every role, so this adds no
  // new privileged call site: it runs on the client the caller already
  // passed in. Today it returns the empty set and this costs one round trip.
  const { data: sandboxTenants, error: sandboxError } = await admin.rpc(
    "hq_sandbox_company_ids",
  );
  if (sandboxError || !Array.isArray(sandboxTenants)) {
    return {
      ok: false,
      reason:
        "Could not confirm whether a sandbox tenant exists, so this invite " +
        "was not sent. This path bypasses the sendEmail() chokepoint and has " +
        "no recipient allowlist, so it fails closed. Send the invite URL by " +
        "hand.",
      inviteUrl,
    };
  }
  if (sandboxTenants.length > 0) {
    return {
      ok: false,
      reason:
        "A sandbox tenant exists and this invite path bypasses the " +
        "sendEmail() chokepoint, so it carries no recipient allowlist. " +
        "Route firm invites through the chokepoint before provisioning, or " +
        "send the invite URL by hand.",
      inviteUrl,
    };
  }

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
