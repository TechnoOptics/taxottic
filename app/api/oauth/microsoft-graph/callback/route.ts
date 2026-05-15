import { NextRequest, NextResponse } from "next/server";
import { requireUserWithAdmin } from "@/lib/auth";
import { verifyOauthState } from "@/lib/firm/oauth/state";
import {
  exchangeCode,
  fetchUserinfo,
  getProvider,
  siteOrigin,
} from "@/lib/firm/oauth/providers";
import { logFirmActivity } from "@/lib/firm/activity";

export async function GET(req: NextRequest) {
  const { admin, user } = await requireUserWithAdmin();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const back = `${siteOrigin()}/firm/settings/calendar`;
  if (errorParam)
    return NextResponse.redirect(`${back}?error=${encodeURIComponent(errorParam)}`);
  if (!code || !state)
    return NextResponse.redirect(`${back}?error=missing_code_or_state`);
  const parsed = await verifyOauthState(state);
  if (!parsed || parsed.prov !== "microsoft" || parsed.uid !== user.id) {
    return NextResponse.redirect(`${back}?error=invalid_state`);
  }
  const provider = getProvider("microsoft");
  const exchanged = await exchangeCode(provider, code);
  if (!exchanged.ok) {
    return NextResponse.redirect(
      `${back}?error=${encodeURIComponent(exchanged.reason)}`,
    );
  }
  const token = exchanged.token;
  const userinfo = await fetchUserinfo("microsoft", token.access_token);
  const { encryptTokenJson } = await import("@/lib/firm/oauth/token-vault");
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : null;
  const blob = encryptTokenJson({ ...token, expires_at: expiresAt });
  await admin
    .from("firm_calendar_integrations")
    .upsert(
      {
        firm_id: parsed.fid,
        user_id: parsed.uid,
        provider: "microsoft",
        provider_account_email: userinfo.email ?? null,
        provider_account_id: userinfo.id ?? null,
        encrypted_token_blob: blob,
        scopes: provider.scopes.split(/\s+/),
        expires_at: expiresAt,
        refreshed_at: new Date().toISOString(),
      },
      { onConflict: "firm_id,user_id,provider,provider_account_id" },
    );
  await logFirmActivity({
    client: admin,
    firmId: parsed.fid,
    kind: "firm.note_added",
    summary: `Connected Microsoft Teams${userinfo.email ? ` (${userinfo.email})` : ""}.`,
    payload: { provider: "microsoft", account_email: userinfo.email ?? null },
  });
  return NextResponse.redirect(`${back}?connected=microsoft`);
}
