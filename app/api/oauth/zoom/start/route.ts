import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getFirmContext } from "@/lib/firm/context";
import { signOauthState } from "@/lib/firm/oauth/state";
import { getProvider, siteOrigin } from "@/lib/firm/oauth/providers";

// /api/oauth/zoom/start, initiates the Zoom OAuth flow for the
// currently signed-in firm member.
//
// Flow:
//   1. Verify the user is signed in + a firm member.
//   2. Mint a signed state JWT (15-min expiry) embedding
//      { user_id, firm_id, "zoom", random_nonce }.
//   3. Redirect to Zoom's authorize URL with state, redirect_uri,
//      and scopes.
//
// The callback at /api/oauth/zoom/callback re-verifies the state
// before exchanging the auth code.

export async function GET(_req: NextRequest) {
  const { user } = await requireUser();
  const ctx = await getFirmContext();
  if (!ctx) {
    return NextResponse.redirect(
      `${siteOrigin()}/firms/request-account`,
    );
  }
  const provider = getProvider("zoom");
  const creds = provider.credentials();
  if (!creds) {
    return NextResponse.redirect(
      `${siteOrigin()}/firm/settings/calendar?error=zoom_not_configured`,
    );
  }
  const nonce = crypto.randomUUID();
  const state = await signOauthState({
    uid: user.id,
    fid: ctx.firm.id,
    prov: "zoom",
    n: nonce,
  });
  if (!state) {
    return NextResponse.redirect(
      `${siteOrigin()}/firm/settings/calendar?error=state_sign_failed`,
    );
  }
  const redirectUri = `${siteOrigin()}${provider.redirectPath}`;
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", provider.scopes);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url.toString());
}
