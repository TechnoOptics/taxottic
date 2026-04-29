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
 * Microsoft callback. Mirrors the Google callback closely; the only
 * differences are the token endpoint and that Microsoft requires the
 * client_secret in the body (no client auth header needed for the multi-
 * tenant web flow).
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

  const clientId = process.env.AZURE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.AZURE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return withClearedCookies(
      NextResponse.redirect(`${origin}/login?error=oauth_not_configured`),
    );
  }

  const redirectUri = `${origin}/api/auth/azure/callback`;

  const tokenRes = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        // Echoing the same scope is a no-op for the token endpoint but
        // harmless and matches Microsoft examples.
        scope: "openid email profile",
      }),
      cache: "no-store",
    },
  );

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    console.error("Microsoft token exchange failed", tokenRes.status, detail);
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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "azure",
    token: idToken,
    nonce: cookieNonce,
  });

  if (error) {
    console.error("Supabase signInWithIdToken (azure) failed", error);
    return withClearedCookies(
      NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`,
      ),
    );
  }

  return withClearedCookies(NextResponse.redirect(`${origin}${next}`));
}
