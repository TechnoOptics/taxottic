import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  NEXT_COOKIE,
  NONCE_COOKIE,
  STATE_COOKIE,
  safeNext,
  siteOrigin,
} from "@/lib/auth/oauth";

/**
 * Google's redirect lands here. We validate state, exchange the auth code
 * for tokens, then hand the ID token to Supabase via signInWithIdToken so
 * the SSR cookies get written and the user is logged in.
 *
 * Edge cases:
 *   - User clicked "Cancel" on the consent screen -> Google sends ?error.
 *   - The state cookie is missing (cookies cleared mid-flow) -> we bounce
 *     them back to /login with an error param rather than crash.
 *   - The Supabase email is not yet confirmed (first-time sign-up) -> the
 *     ID token still contains email_verified=true from Google, so Supabase
 *     auto-confirms.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  const cookieNonce = req.cookies.get(NONCE_COOKIE)?.value;
  const cookieNext = req.cookies.get(NEXT_COOKIE)?.value;
  const next = safeNext(cookieNext);

  const origin = siteOrigin(req);

  // Helper: clear our 3 OAuth cookies on whatever response we return so
  // they don't linger after a successful or failed flow.
  function withClearedCookies(res: NextResponse) {
    res.cookies.delete(STATE_COOKIE);
    res.cookies.delete(NONCE_COOKIE);
    res.cookies.delete(NEXT_COOKIE);
    return res;
  }

  if (oauthError) {
    return withClearedCookies(
      NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(oauthError)}`,
      ),
    );
  }

  if (!code || !returnedState || !cookieState || !cookieNonce) {
    return withClearedCookies(
      NextResponse.redirect(`${origin}/login?error=oauth_state_missing`),
    );
  }

  if (returnedState !== cookieState) {
    return withClearedCookies(
      NextResponse.redirect(`${origin}/login?error=oauth_state_mismatch`),
    );
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return withClearedCookies(
      NextResponse.redirect(`${origin}/login?error=oauth_not_configured`),
    );
  }

  const redirectUri = `${origin}/api/auth/google/callback`;

  // Exchange the auth code for tokens against Google's token endpoint.
  // We need the id_token; access_token is unused.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    // Don't cache the token exchange.
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    console.error("Google token exchange failed", tokenRes.status, detail);
    return withClearedCookies(
      NextResponse.redirect(`${origin}/login?error=oauth_token_exchange`),
    );
  }

  const tokenJson = (await tokenRes.json()) as { id_token?: string };
  const idToken = tokenJson.id_token;
  if (!idToken) {
    return withClearedCookies(
      NextResponse.redirect(`${origin}/login?error=oauth_missing_id_token`),
    );
  }

  // Supabase handles JWT signature verification and the nonce check.
  // signInWithIdToken writes the SSR auth cookies via our createClient
  // wrapper, so after this call subsequent server components see a logged-in
  // user.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    nonce: cookieNonce,
  });

  if (error) {
    console.error("Supabase signInWithIdToken (google) failed", error);
    return withClearedCookies(
      NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`,
      ),
    );
  }

  return withClearedCookies(NextResponse.redirect(`${origin}${next}`));
}
