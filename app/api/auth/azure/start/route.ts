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
 * Microsoft / Entra ID equivalent of the Google start endpoint. Same idea:
 * by making the redirect_uri point at taxottic.com, Microsoft's consent
 * screen reads "to continue to taxottic.com" instead of the Supabase
 * project URL.
 *
 * We use the multi-tenant /common authority so both work and personal
 * Microsoft accounts can sign in.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.AZURE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "AZURE_OAUTH_CLIENT_ID is not configured" },
      { status: 500 },
    );
  }

  const origin = siteOrigin(req);
  const redirectUri = `${origin}/api/auth/azure/callback`;

  const state = randomToken();
  const nonce = randomToken();
  const next = safeNext(req.nextUrl.searchParams.get("next"));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // openid + email + profile gives us the email claim Supabase needs.
    // offline_access is omitted because we don't need a refresh token here.
    scope: "openid email profile",
    state,
    nonce,
    response_mode: "query",
    prompt: "select_account",
  });

  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  const res = NextResponse.redirect(authUrl);

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
