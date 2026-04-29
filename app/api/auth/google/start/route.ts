import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE_MAX_AGE,
  NEXT_COOKIE,
  NONCE_COOKIE,
  STATE_COOKIE,
  randomToken,
  safeNext,
  siteOrigin,
} from "@/lib/auth/oauth";

/**
 * Kick off the Google OIDC code flow on our own domain.
 *
 * The user clicks "Continue with Google" on /login, which now hits this
 * endpoint instead of supabase.auth.signInWithOAuth. We generate a state
 * (CSRF guard) and a nonce (replay guard, lands inside the issued ID token),
 * stash both in HttpOnly cookies, and redirect to Google with
 * redirect_uri pointing at our /callback. Because the redirect_uri lives on
 * taxottic.com, Google's consent screen reads "to continue to taxottic.com".
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GOOGLE_OAUTH_CLIENT_ID is not configured" },
      { status: 500 },
    );
  }

  const origin = siteOrigin(req);
  const redirectUri = `${origin}/api/auth/google/callback`;

  const state = randomToken();
  const nonce = randomToken();
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    // Always show the chooser so users can switch accounts. Without this,
    // Google silently picks the most recently used account, which is
    // confusing on shared devices.
    prompt: "select_account",
    access_type: "online",
    include_granted_scopes: "true",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  const res = NextResponse.redirect(authUrl);

  // HttpOnly so JS can't read them, Lax so the cookie still rides on the
  // top-level redirect back from Google. Secure in production; in localhost
  // dev (http) we leave it off so the cookie actually gets set.
  const isProd = process.env.NODE_ENV === "production";
  const cookieOpts = {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
  res.cookies.set(STATE_COOKIE, state, cookieOpts);
  res.cookies.set(NONCE_COOKIE, nonce, cookieOpts);
  res.cookies.set(NEXT_COOKIE, next, cookieOpts);

  return res;
}
