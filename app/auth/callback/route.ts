import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * OAuth + magic-link callback.
 *
 * Flow:
 *   1. signInWithOAuth() runs in the browser, sets the PKCE
 *      code_verifier cookie + stashes `next` in the _oauth_next cookie
 *      (see app/login/page.tsx), then redirects through the provider.
 *   2. Provider redirects back here with `?code=...&state=...`.
 *   3. We call `exchangeCodeForSession(code)` server-side. That reads
 *      the PKCE code_verifier from cookies and asks Supabase for the
 *      session. Supabase writes the `sb-<ref>-auth-token` cookies onto
 *      THIS response (see the response-mutating pattern below — this
 *      is the critical bit; using next/headers cookieStore can drop
 *      cookies on NextResponse.redirect in some Next 16 runtimes,
 *      which is what was leaving users at /login after a "successful"
 *      OAuth flow in May 2026 PR #52's first cut).
 *   4. On success: 307 to `next` (default /dashboard). Auth cookies
 *      are on that redirect response so the next request is signed in.
 *   5. On failure: 307 to /login with a concrete error code so the
 *      login page can render a helpful message AND so support can
 *      tell which leg of the flow broke.
 *
 * Provider-upstream errors (user cancelled, AAD tenant config wrong,
 * etc.) arrive here as `?error=...&error_description=...` BEFORE
 * `code` ever lands. We pass them straight through so the login page
 * shows what the provider said.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // `next` comes from a short-lived same-origin cookie set by the
  // login page before signInWithOAuth (see PR #52). Falling back to
  // `?next=` and finally to `/dashboard` keeps magic-link callbacks
  // and old in-flight redirects working.
  const cookieNextRaw = request.cookies.get("_oauth_next")?.value;
  let cookieNext: string | undefined;
  if (cookieNextRaw) {
    try {
      cookieNext = decodeURIComponent(cookieNextRaw);
    } catch {
      cookieNext = cookieNextRaw;
    }
  }
  const next = searchParams.get("next") ?? cookieNext ?? "/dashboard";

  // Upstream OAuth error (Google/Microsoft/Apple rejected before
  // issuing a code). Forward both the error code and the description
  // so /login can show the user what happened.
  const upstreamError = searchParams.get("error");
  if (upstreamError) {
    const desc = searchParams.get("error_description") ?? "";
    const out = new URL(`${origin}/login`);
    out.searchParams.set("error", upstreamError);
    if (desc) out.searchParams.set("error_description", desc);
    return NextResponse.redirect(out);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  // CRITICAL: we use the response-mutating cookie pattern (NOT the
  // next/headers cookieStore pattern) for this handler. In Next 16 +
  // Turbopack, cookies set via `cookies().set()` are not reliably
  // propagated to NextResponse.redirect() — the Supabase auth-token
  // cookies were going missing on the final redirect, even though
  // `auth.sessions` had a fresh row, leaving users back at /login
  // immediately after a "successful" OAuth flow. Pinning the response
  // up front + writing cookies onto it directly is the canonical fix.
  let response = NextResponse.redirect(new URL(`${origin}${next}`));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set({ name, value, ...options });
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (!error) {
    // Clear the one-shot _oauth_next cookie now that we've consumed it.
    response.cookies.set({
      name: "_oauth_next",
      value: "",
      maxAge: 0,
      path: "/",
    });
    return response;
  }

  // Exchange failed — build a fresh error response. Cookies set on the
  // previous `response` object would not have been worth keeping
  // (no valid session) but we surface the Supabase error message so
  // /login can render something more useful than "auth failed".
  console.error("[auth/callback] exchangeCodeForSession failed", {
    message: error.message,
    name: error.name,
    status: (error as { status?: number }).status,
  });

  const errOut = new URL(`${origin}/login`);
  errOut.searchParams.set("error", "exchange_failed");
  errOut.searchParams.set("error_description", error.message);
  return NextResponse.redirect(errOut);
}
