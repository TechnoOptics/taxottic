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
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  // Upstream OAuth error (Google/Microsoft/Apple rejected before
  // issuing a code). Forward both the error code and the
  // description so /login can show the user what happened.
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

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (!error) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Log the real Supabase error server-side so we have it in the
  // Vercel logs the next time a user reports "OAuth doesn't work."
  // Browser-visible message goes through the structured query
  // string so the /login page can render a helpful explanation.
  console.error("[auth/callback] exchangeCodeForSession failed", {
    message: error.message,
    name: error.name,
    status: (error as { status?: number }).status,
  });

  const out = new URL(`${origin}/login`);
  out.searchParams.set("error", "exchange_failed");
  out.searchParams.set("error_description", error.message);
  return NextResponse.redirect(out);
}
