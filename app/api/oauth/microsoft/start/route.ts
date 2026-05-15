import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getFirmContext } from "@/lib/firm/context";
import { signOauthState } from "@/lib/firm/oauth/state";
import { getProvider, siteOrigin } from "@/lib/firm/oauth/providers";

export async function GET(_req: NextRequest) {
  const { user } = await requireUser();
  const ctx = await getFirmContext();
  if (!ctx) {
    return NextResponse.redirect(`${siteOrigin()}/firms/request-account`);
  }
  const provider = getProvider("microsoft");
  const creds = provider.credentials();
  if (!creds) {
    return NextResponse.redirect(
      `${siteOrigin()}/firm/settings/calendar?error=microsoft_not_configured`,
    );
  }
  const state = await signOauthState({
    uid: user.id,
    fid: ctx.firm.id,
    prov: "microsoft",
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
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("prompt", "consent");
  return NextResponse.redirect(url.toString());
}
