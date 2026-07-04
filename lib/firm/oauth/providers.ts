// Per-provider OAuth metadata. Authorize URL, token URL, scope
// strings, client-id env keys.
//
// All three providers we support (Zoom, Google, Microsoft Graph)
// use OAuth 2.0 authorization-code flow with PKCE-optional. We do
// not currently use PKCE, the state JWT covers CSRF, but
// providers that require it can be wired without changing the
// route shape.

export type ProviderId = "zoom" | "google" | "microsoft";

export type ProviderConfig = {
  id: ProviderId;
  /** Provider's OAuth authorize endpoint. */
  authorizeUrl: string;
  /** Provider's token endpoint. */
  tokenUrl: string;
  /** Space-separated scopes requested at authorize time. */
  scopes: string;
  /** Returns the configured client id + secret, or null when env is
   *  missing. */
  credentials(): { clientId: string; clientSecret: string } | null;
  /** Path the callback route reads; full URL is built using
   *  NEXT_PUBLIC_SITE_URL or the request origin. */
  redirectPath: string;
};

const ZOOM: ProviderConfig = {
  id: "zoom",
  authorizeUrl: "https://zoom.us/oauth/authorize",
  tokenUrl: "https://zoom.us/oauth/token",
  scopes: "meeting:write user:read",
  credentials() {
    const id = process.env.ZOOM_OAUTH_CLIENT_ID;
    const secret = process.env.ZOOM_OAUTH_CLIENT_SECRET;
    if (!id || !secret) return null;
    return { clientId: id, clientSecret: secret };
  },
  redirectPath: "/api/oauth/zoom/callback",
};

const GOOGLE: ProviderConfig = {
  id: "google",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes:
    "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email openid",
  credentials() {
    // Re-uses the existing Google OAuth client used for sign-in.
    // Add `https://www.googleapis.com/auth/calendar.events` to its
    // granted scopes + add the callback path to its authorized
    // redirect URIs.
    const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!id || !secret) return null;
    return { clientId: id, clientSecret: secret };
  },
  redirectPath:
    process.env.GOOGLE_CALENDAR_REDIRECT_PATH ??
    "/api/oauth/google-calendar/callback",
};

const MICROSOFT: ProviderConfig = {
  id: "microsoft",
  // /common works for both personal + work accounts. Use /organizations
  // to restrict to Entra-joined tenants.
  authorizeUrl:
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes:
    "OnlineMeetings.ReadWrite Calendars.ReadWrite offline_access User.Read",
  credentials() {
    const id = process.env.AZURE_OAUTH_CLIENT_ID;
    const secret = process.env.AZURE_OAUTH_CLIENT_SECRET;
    if (!id || !secret) return null;
    return { clientId: id, clientSecret: secret };
  },
  redirectPath:
    process.env.MS_GRAPH_REDIRECT_PATH ??
    "/api/oauth/microsoft-graph/callback",
};

export function getProvider(id: ProviderId): ProviderConfig {
  switch (id) {
    case "zoom":
      return ZOOM;
    case "google":
      return GOOGLE;
    case "microsoft":
      return MICROSOFT;
  }
}

export function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_SITE_ORIGIN ??
    "https://taxottic.com"
  ).replace(/\/$/, "");
}

export type ExchangedToken = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  /** Some providers (Google, Zoom) return additional fields we
   *  pass through verbatim for storage. */
  [key: string]: unknown;
};

export async function exchangeCode(
  provider: ProviderConfig,
  code: string,
): Promise<{ ok: true; token: ExchangedToken } | { ok: false; reason: string }> {
  const creds = provider.credentials();
  if (!creds) return { ok: false, reason: "creds not configured" };

  const redirectUri = `${siteOrigin()}${provider.redirectPath}`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  try {
    const res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `token exchange ${res.status}: ${txt.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as ExchangedToken;
    if (!json.access_token) {
      return { ok: false, reason: "token response missing access_token" };
    }
    return { ok: true, token: json };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}

/**
 * Best-effort fetch of the connected account's email + canonical id
 * from the provider's userinfo endpoint. Used to populate
 * provider_account_email + provider_account_id on the
 * firm_calendar_integrations row so the UI shows "connected as
 * x@y.com" without re-querying.
 */
export async function fetchUserinfo(
  provider: ProviderId,
  accessToken: string,
): Promise<{ email?: string; id?: string }> {
  try {
    if (provider === "zoom") {
      const res = await fetch("https://api.zoom.us/v2/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return {};
      const json = (await res.json()) as { email?: string; id?: string };
      return { email: json.email, id: json.id };
    }
    if (provider === "google") {
      const res = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return {};
      const json = (await res.json()) as { email?: string; sub?: string };
      return { email: json.email, id: json.sub };
    }
    if (provider === "microsoft") {
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return {};
      const json = (await res.json()) as {
        userPrincipalName?: string;
        mail?: string;
        id?: string;
      };
      return { email: json.mail ?? json.userPrincipalName, id: json.id };
    }
  } catch {
    // ignore
  }
  return {};
}
