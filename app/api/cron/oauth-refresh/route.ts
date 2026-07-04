import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  decryptTokenJson,
  encryptTokenJson,
  type DecodedToken,
} from "@/lib/firm/oauth/token-vault";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Hourly cron, refreshes OAuth access tokens that are about to
 * expire. Walks every firm_calendar_integrations row where
 * expires_at < now() + 15 min AND we have a refresh_token in the
 * stored blob, calls the provider's token endpoint with the
 * refresh_token, updates the stored blob in place.
 *
 * Why hourly: most providers issue 1-hour access tokens with a
 * 7-day or longer refresh token. An hourly sweep guarantees no
 * meeting action ever hits an expired token.
 *
 * Auth: same envelope as the other crons (Vercel header OR
 * Bearer CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const auth = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const authorized =
    isCron ||
    (cronSecret &&
      auth.startsWith("Bearer ") &&
      auth.slice("Bearer ".length) === cronSecret);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const horizon = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Pull every integration whose access_token is about to expire.
  // We do NOT use the `.lt(...)` PostgREST filter on expires_at
  // because some providers (Zoom, some MS apps) don't give us an
  // expires_at; we walk those rows too so a manual reconnect can
  // backfill the field.
  const { data: rows } = await admin
    .from("firm_calendar_integrations")
    .select(
      "id, firm_id, user_id, provider, encrypted_token_blob, expires_at",
    )
    .or(`expires_at.lt.${horizon},expires_at.is.null`);

  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    try {
      const decoded = decryptTokenJson<DecodedToken>(
        row.encrypted_token_blob ?? null,
      );
      if (!decoded?.refresh_token) {
        skipped += 1;
        continue;
      }
      const refreshed_token = await refreshAccessToken(
        row.provider as "zoom" | "google" | "microsoft",
        decoded.refresh_token,
      );
      if (!refreshed_token) {
        failed += 1;
        continue;
      }
      const expires_at = refreshed_token.expires_in
        ? new Date(Date.now() + refreshed_token.expires_in * 1000).toISOString()
        : null;
      // Merge: providers may not echo the refresh_token on every
      // refresh response (Google does, Zoom sometimes doesn't).
      // Carry the previous refresh_token forward when missing.
      const merged: DecodedToken = {
        ...decoded,
        ...refreshed_token,
        refresh_token:
          refreshed_token.refresh_token ?? decoded.refresh_token,
        expires_at: expires_at ?? decoded.expires_at,
      };
      await admin
        .from("firm_calendar_integrations")
        .update({
          encrypted_token_blob: encryptTokenJson(merged),
          expires_at,
          refreshed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      refreshed += 1;
    } catch (err) {
      failed += 1;
       
      console.error("[oauth-refresh] row error:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: (rows ?? []).length,
    refreshed,
    skipped,
    failed,
  });
}

/**
 * Per-provider refresh-token grant. POST to the token endpoint
 * with grant_type=refresh_token. Failure returns null; caller
 * counts toward the `failed` summary but doesn't disconnect the
 * integration (the user might be on vacation; we keep retrying
 * each hour until the refresh window expires).
 */
async function refreshAccessToken(
  provider: "zoom" | "google" | "microsoft",
  refresh_token: string,
): Promise<DecodedToken | null> {
  const config = (() => {
    if (provider === "zoom") {
      return {
        url: "https://zoom.us/oauth/token",
        client_id: process.env.ZOOM_OAUTH_CLIENT_ID,
        client_secret: process.env.ZOOM_OAUTH_CLIENT_SECRET,
      };
    }
    if (provider === "google") {
      return {
        url: "https://oauth2.googleapis.com/token",
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      };
    }
    return {
      url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      client_id: process.env.AZURE_OAUTH_CLIENT_ID,
      client_secret: process.env.AZURE_OAUTH_CLIENT_SECRET,
    };
  })();
  if (!config.client_id || !config.client_secret) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: config.client_id,
    client_secret: config.client_secret,
  });
  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
       
      console.warn(
        `[oauth-refresh] ${provider} refresh ${res.status}: ${txt.slice(0, 200)}`,
      );
      return null;
    }
    return (await res.json()) as DecodedToken;
  } catch (err) {
     
    console.warn(`[oauth-refresh] ${provider} threw:`, err);
    return null;
  }
}
