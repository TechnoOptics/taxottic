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

// /api/oauth/zoom/callback — receives ?code + ?state from Zoom,
// exchanges code for tokens, persists in
// firm_calendar_integrations, redirects to the calendar settings
// page with a success or error flash.

export async function GET(req: NextRequest) {
  const { admin, user } = await requireUserWithAdmin();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const back = `${siteOrigin()}/firm/settings/calendar`;

  if (errorParam) {
    return NextResponse.redirect(`${back}?error=${encodeURIComponent(errorParam)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${back}?error=missing_code_or_state`);
  }
  const parsed = await verifyOauthState(state);
  if (!parsed || parsed.prov !== "zoom" || parsed.uid !== user.id) {
    return NextResponse.redirect(`${back}?error=invalid_state`);
  }

  const provider = getProvider("zoom");
  const exchanged = await exchangeCode(provider, code);
  if (!exchanged.ok) {
    return NextResponse.redirect(
      `${back}?error=${encodeURIComponent(exchanged.reason)}`,
    );
  }
  const token = exchanged.token;
  const userinfo = await fetchUserinfo("zoom", token.access_token);

  // Phase 10 v1: store the token JSON as base64 in
  // encrypted_token_blob. Real envelope encryption (pgsodium /
  // KMS) lands in Phase 10.5 alongside the same upgrade for the
  // bank_connection_secrets table. Service-role-only reads (RLS
  // already restricts SELECT to the owning user); base64 keeps
  // the column type consistent with the future encrypted version.
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : null;
  const blob = Buffer.from(JSON.stringify(token)).toString("base64");

  await admin
    .from("firm_calendar_integrations")
    .upsert(
      {
        firm_id: parsed.fid,
        user_id: parsed.uid,
        provider: "zoom",
        provider_account_email: userinfo.email ?? null,
        provider_account_id: userinfo.id ?? null,
        encrypted_token_blob: blob,
        scopes: provider.scopes.split(/\s+/),
        expires_at: expiresAt,
        refreshed_at: new Date().toISOString(),
      },
      {
        onConflict: "firm_id,user_id,provider,provider_account_id",
      },
    );

  await logFirmActivity({
    client: admin,
    firmId: parsed.fid,
    kind: "firm.note_added",
    summary: `Connected Zoom${userinfo.email ? ` (${userinfo.email})` : ""}.`,
    payload: {
      provider: "zoom",
      account_email: userinfo.email ?? null,
    },
  });

  return NextResponse.redirect(`${back}?connected=zoom`);
}
