import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getFirmContext } from "@/lib/firm/context";
import { signOauthState } from "@/lib/firm/oauth/state";
import { getProvider, siteOrigin } from "@/lib/firm/oauth/providers";

// /api/oauth/google/start, same shape as zoom/start. Google's
// authorize URL also accepts `access_type=offline` + `prompt=consent`
// to ensure we get a refresh token on first connect (without
// prompt=consent Google may issue access_token without
// refresh_token if the user has previously consented to the same
// scopes).

export async function GET(_req: NextRequest) {
  const { user } = await requireUser();
  const ctx = await getFirmContext();
  if (!ctx) {
    return NextResponse.redirect(`${siteOrigin()}/firms/request-account`);
  }
  const provider = getProvider("google");
  const creds = provider.credentials();
  if (!creds) {
    return NextResponse.redirect(
      `${siteOrigin()}/firm/settings/calendar?error=google_not_configured`,
    );
  }
  const state = await signOauthState({
    uid: user.id,
    fid: ctx.firm.id,
    prov: "google",
    n: crypto.randomUUID(),
  });
  if (!state) {
    return NextResponse.redirect(
      `${siteOrigin()}/firm/settings/calendar?error=state_sign_failed`,
    );
  }
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", `${siteOrigin()}${provider.redirectPath}`);
  url.searchParams.set("scope", provider.scopes);
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return NextResponse.redirect(url.toString());
}
