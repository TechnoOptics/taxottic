import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth + magic-link callback.
 *
 * Flow:
 *   1. signInWithOAuth() runs in the browser, redirects through the
 *      provider, and lands back here with `?code=...` (plus the
 *      `next=` we forwarded through the OAuth state).
 *   2. We call `exchangeCodeForSession(code)` server-side. That
 *      reads the PKCE code_verifier from cookies (set during step 1
 *      by the browser client) and asks Supabase for the session.
 *   3. On success: 307 to `next` (default /dashboard).
 *   4. On failure: 307 to /login with a CONCRETE error code so the
 *      login page can render a helpful message AND so support can
 *      tell which leg of the flow broke. We deliberately surface the
 *      Supabase error name in the query string — that's much more
 *      actionable than the previous opaque `error=auth`.
 *
 * Provider-upstream errors (user cancelled, AAD tenant config wrong,
 * etc.) arrive here as `?error=...&error_description=...` BEFORE
 * `code` ever lands. We pass them straight through so the login page
 * shows what the provider said.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin, pathname, search, host } = new URL(request.url);
  const code = searchParams.get("code");
  // PR #52: `next` now comes from a short-lived cookie set by the login
  // page BEFORE signInWithOAuth is called. We used to read it from the
  // query string (?next=...) but Supabase's redirect-URL allowlist
  // rejects callback URLs that don't EXACTLY match the registered
  // entry, and a `?next=/dashboard` suffix caused silent fall-back to
  // Site URL — bypassing this handler entirely. Cookie path keeps
  // redirect_to stable so Supabase always matches the allowlist.
  const cookieNextRaw = request.cookies.get("_oauth_next")?.value;
  // Cookie value was set via `encodeURIComponent(next)` on the client
  // (see app/login/page.tsx). Decode here, but accept either form so
  // a missing/double-decode doesn't break the post-login redirect.
  let cookieNext: string | undefined;
  if (cookieNextRaw) {
    try {
      cookieNext = decodeURIComponent(cookieNextRaw);
    } catch {
      cookieNext = cookieNextRaw;
    }
  }
  const next = searchParams.get("next") ?? cookieNext ?? "/dashboard";

  // TRACE diagnostic (PR #49): leave a unmissable trace on every hit
  // to /auth/callback. Real OAuth flows land users on /login?next=/
  // with no `_oauth_diag` or `error` — meaning neither our success
  // nor failure path is being taken — yet auth.flow_state has an
  // auth_code_issued_at row, so Supabase HAS run its callback. This
  // narrows "did the browser ever reach /auth/callback?" to a yes/no
  // we can read straight off the URL.
  console.error("[auth/callback] HIT", {
    host,
    pathname,
    search,
    hasCode: !!code,
    hasState: !!searchParams.get("state"),
    hasError: !!searchParams.get("error"),
  });

  // Upstream OAuth error (Google/Microsoft/Apple rejected before
  // issuing a code). Forward both the error code and the
  // description so /login can show the user what happened.
  const upstreamError = searchParams.get("error");
  if (upstreamError) {
    const desc = searchParams.get("error_description") ?? "";
    const out = new URL(`${origin}/login`);
    out.searchParams.set("error", upstreamError);
    if (desc) out.searchParams.set("error_description", desc);
    out.searchParams.set("_oauth_diag", "callback_upstream_error");
    return NextResponse.redirect(out);
  }

  if (!code) {
    const out = new URL(`${origin}/login`);
    out.searchParams.set("error", "no_code");
    out.searchParams.set(
      "_oauth_diag",
      `callback_no_code;path=${pathname};search=${search}`,
    );
    return NextResponse.redirect(out);
  }

  // Diagnostic snapshot: which `sb-*` cookies actually arrived on the
  // callback request? In production we've been seeing
  // "PKCE code verifier not found in storage" with no good local repro;
  // surfacing the cookie names the server actually receives is the
  // shortest path to "the cookie is/isn't being sent back from the
  // OAuth dance." Cookie *values* are never exposed (those are the
  // session itself); only names + presence-of-verifier.
  const sbCookieNames = request.cookies
    .getAll()
    .map((c) => c.name)
    .filter((n) => n.startsWith("sb-"));
  const verifierExpected = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  )
    .replace(/^https?:\/\//, "")
    .split(".")[0];
  const verifierCookieName = `sb-${verifierExpected}-auth-token-code-verifier`;
  const verifierPresent = sbCookieNames.includes(verifierCookieName);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (!error) {
    // Success-path diagnostic: confirm we reached this branch AND
    // that we have a session/user. Appended as a query param on the
    // post-redirect URL so the user can see (and we can read) what
    // happened. Removed after RCA — see PR #47.
    const successUrl = new URL(`${origin}${next}`);
    successUrl.searchParams.set(
      "_oauth_diag",
      `success;next=${next};user=${data?.user?.id ?? "none"};session=${
        data?.session ? "yes" : "no"
      };sb_cookies=${sbCookieNames.join(",") || "(none)"}`,
    );
    return NextResponse.redirect(successUrl);
  }

  // Log the real Supabase error server-side so we have it in the
  // Vercel logs the next time a user reports "OAuth doesn't work."
  // Browser-visible message goes through the structured query
  // string so the /login page can render a helpful explanation.
  console.error("[auth/callback] exchangeCodeForSession failed", {
    message: error.message,
    name: error.name,
    status: (error as { status?: number }).status,
    sbCookies: sbCookieNames,
    verifierExpected: verifierCookieName,
    verifierPresent,
  });

  const out = new URL(`${origin}/login`);
  out.searchParams.set("error", "exchange_failed");
  out.searchParams.set(
    "error_description",
    `${error.message} [diag: verifier=${
      verifierPresent ? "present" : "MISSING"
    } sb_cookies=${sbCookieNames.join(",") || "(none)"}]`,
  );
  return NextResponse.redirect(out);
}
