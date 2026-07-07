import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { encryptBankToken } from "@/lib/crypto/bankTokens";
import { exchangeOAuthCode } from "@/lib/stripe-connect/client";
import { syncStripeConnection } from "@/lib/stripe-connect/sync";
import { logCompanyActivity } from "@/lib/activity/log";

export const runtime = "nodejs";

/**
 * Stripe Connect OAuth callback. Stripe redirects the user here after
 * they approve our access on Stripe's hosted consent screen, with
 * either `code` (success) or `error` (user denied, mismatched scope,
 * etc) in the query string.
 *
 * Flow:
 *   1. Validate CSRF state against the cookie we set in connect-link.
 *   2. Exchange code for access_token + stripe_user_id.
 *   3. Persist a bank_connections row with provider='stripe' and the
 *      access_token (encrypted) in bank_connection_secrets.
 *   4. Kick off an initial sync (force:true so the first-month
 *      throttle doesn't bite).
 *   5. Redirect the user back to /c/[publicId]/banks with a
 *      success/error toast hint in the query string.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("stripe_oauth_state")?.value ?? null;
  const companyId = cookieStore.get("stripe_oauth_company")?.value ?? null;

  // Clean up the OAuth cookies regardless of outcome. Setting maxAge=0
  // tells the browser to delete them.
  function clearOAuthCookies(response: NextResponse): NextResponse {
    response.cookies.set("stripe_oauth_state", "", {
      maxAge: 0,
      path: "/",
    });
    response.cookies.set("stripe_oauth_company", "", {
      maxAge: 0,
      path: "/",
    });
    return response;
  }

  // Need an authed user before we can read companies; if the session
  // expired during the round-trip, bounce to login with a next= param
  // pointing back to banks.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return clearOAuthCookies(
      NextResponse.redirect(
        new URL(
          `/login?next=${encodeURIComponent("/dashboard")}`,
          url.origin,
        ),
      ),
    );
  }

  // Resolve public_id up front so every error path can redirect to
  // the right banks page.
  let publicId: string | null = null;
  if (companyId) {
    const { data: c } = await supabase
      .from("companies")
      .select("public_id")
      .eq("id", companyId)
      .maybeSingle();
    publicId = (c?.public_id as string | null) ?? null;
  }
  const banksUrl = publicId
    ? new URL(`/c/${publicId}/banks`, url.origin)
    : new URL("/dashboard", url.origin);

  function fail(reason: string): NextResponse {
    const target = new URL(banksUrl);
    target.searchParams.set("stripe_error", reason);
    return clearOAuthCookies(NextResponse.redirect(target));
  }

  if (error) {
    // Stripe-side denial: user clicked "Cancel" or our scope was
    // rejected. Surface the friendly description if Stripe provided
    // one, else just say "denied".
    return fail(errorDescription || error);
  }

  if (!code || !state) {
    return fail("Missing OAuth response from Stripe.");
  }
  if (!stateCookie || stateCookie !== state) {
    // CSRF check failed - either the cookie expired (10 minutes is
    // shorter than Stripe's OAuth screen sometimes takes) or someone
    // tried to feed us a code from a different session. Either way,
    // refuse.
    return fail("OAuth session expired or invalid. Try connecting again.");
  }
  if (!companyId) {
    return fail("OAuth session expired - no company on file.");
  }

  // Sanity-check the user still belongs to the company they
  // initiated the flow from. Catches the edge case where a user gets
  // removed from a company mid-OAuth.
  const { data: membership } = await supabase
    .from("company_members")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!membership) {
    return fail("You're no longer a member of this company.");
  }

  // Exchange code -> access_token + stripe_user_id.
  let stripeUserId: string;
  let accessToken: string;
  try {
    const tok = await exchangeOAuthCode(code);
    stripeUserId = tok.stripeUserId;
    accessToken = tok.accessToken;
  } catch (err) {
    return fail(
      err instanceof Error
        ? `Stripe rejected the OAuth exchange: ${err.message}`
        : "Stripe rejected the OAuth exchange.",
    );
  }

  // Persist the connection. Use the same UPSERT-by-external-item-id
  // pattern as Plaid so re-linking the same Stripe account (e.g.
  // after a revoke + reconnect) just refreshes the token instead of
  // duplicating rows. Service role here because writes to
  // bank_connection_secrets bypass RLS - the access token is
  // strictly server-side.
  const admin = createServiceClient();
  // When the SAME Stripe account is re-linked after a previous
  // Disconnect, this UPSERT lands on the existing row by
  // external_item_id. We MUST clear every "in the recycle bin" /
  // "previous sync state" field so the reconnect actually behaves
  // like a fresh one, otherwise the row stays soft-deleted
  // (post-#148 the sync correctly refuses it) and/or resumes from a
  // stale `cursor`, so the user sees nothing import.
  const { data: connection, error: connErr } = await admin
    .from("bank_connections")
    .upsert(
      {
        company_id: companyId,
        created_by: user.id,
        provider: "stripe",
        external_item_id: stripeUserId,
        institution_id: "stripe",
        institution_name: "Stripe",
        institution_logo_url: null,
        status: "pending",
        // Resurrect a previously-disconnected row + clear its sync
        // state so the upcoming sync starts from the newest events.
        deleted_at: null,
        cursor: null,
        last_synced_at: null,
        last_error: null,
      },
      { onConflict: "external_item_id" },
    )
    .select("id")
    .single();
  if (connErr || !connection) {
    return fail(connErr?.message ?? "Could not save the Stripe connection.");
  }

  await logCompanyActivity(admin, {
    companyId,
    actorUserId: user.id,
    kind: "bank.connected",
    summary: "Connected a Stripe account",
    payload: { provider: "stripe" },
  });

  // Encrypt-then-persist. Same crypto module Plaid uses; the column
  // is named access_token but Stripe Connect access tokens look
  // identical to Plaid's at rest (long random string).
  let accessTokenEnc: string;
  try {
    accessTokenEnc = encryptBankToken(accessToken);
  } catch (err) {
    return fail(
      err instanceof Error
        ? `Token encryption failed: ${err.message}`
        : "Token encryption failed.",
    );
  }
  await admin.from("bank_connection_secrets").upsert(
    {
      connection_id: connection.id,
      access_token: null,
      access_token_enc: accessTokenEnc,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id" },
  );

  // Initial sync. force:true bypasses the monthly throttle for the
  // very first run so the user sees data immediately. If sync fails
  // we still leave the connection in 'pending' so the UI can show a
  // reconnect/retry affordance.
  try {
    await syncStripeConnection(admin, connection.id, { force: true });
  } catch (err) {
    await admin
      .from("bank_connections")
      .update({
        status: "error",
        last_error: err instanceof Error ? err.message : String(err),
      })
      .eq("id", connection.id);
    return fail(
      err instanceof Error
        ? `Connected, but the first sync failed: ${err.message}`
        : "Connected, but the first sync failed.",
    );
  }

  const target = new URL(banksUrl);
  target.searchParams.set("stripe_connected", "1");
  return clearOAuthCookies(NextResponse.redirect(target));
}
