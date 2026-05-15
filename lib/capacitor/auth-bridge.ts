// Native OAuth bridge for the Capacitor shell.
//
// THE BUG THIS FIXES
// ------------------
// The app is a Capacitor WebView that loads https://taxottic.com
// (server.url in capacitor.config.ts). The web login page calls
// supabase.auth.signInWithOAuth({ redirectTo:
// `${window.location.origin}/auth/callback` }). Inside the shell
// window.location.origin === "https://taxottic.com", so:
//
//   1. signInWithOAuth navigates the WebView to Google/Apple/MS.
//   2. Google refuses OAuth in an embedded WebView
//      ("disallowed_useragent"), so it (or the system) punts the
//      flow to the OS browser.
//   3. The provider redirects to https://taxottic.com/auth/callback
//      — which opens/stays in the SYSTEM BROWSER. The Supabase
//      session cookie is written there.
//   4. The native WebView never sees the session. User is "logged
//      in" in Safari/Chrome but the app is still on /login.
//
// THE FIX (standard Supabase + Capacitor pattern)
// -----------------------------------------------
//   - On native, start OAuth with skipBrowserRedirect + a CUSTOM
//     SCHEME redirect (com.taxottic.app://auth-callback) and open
//     the provider URL in an in-app browser tab (SFSafariViewController
//     / Chrome Custom Tab) where Google DOES allow OAuth.
//   - The OS routes the custom-scheme redirect back into the app;
//     Capacitor fires `appUrlOpen`.
//   - We catch it IN THE WEBVIEW, run exchangeCodeForSession(code)
//     so the session lands in the WebView's cookie jar, close the
//     in-app browser, and navigate to the post-login destination.
//
// Everything here is dynamically imported and platform-guarded so
// the normal web build (also served from taxottic.com to desktop
// browsers) is completely unaffected — isNativePlatform() is false
// there and every native path no-ops.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Custom URL scheme redirect. Must be registered natively
 *  (ios Info.plist CFBundleURLTypes + Android manifest intent-filter)
 *  AND allow-listed in Supabase Auth → URL Configuration. */
export const NATIVE_OAUTH_REDIRECT = "com.taxottic.app://auth-callback";

const NATIVE_NEXT_KEY = "__taxottic_oauth_next_native";

/** True only inside the Capacitor native shell. Safe on SSR + web. */
export async function isNativeApp(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Native OAuth sign-in. Returns true if it handled the flow (native),
 * false if the caller should fall back to the normal web redirect.
 */
export async function nativeOAuthSignIn(
  supabase: SupabaseClient,
  provider: "google" | "azure" | "apple",
  opts: {
    scopes?: string;
    queryParams?: Record<string, string>;
    next?: string;
  },
): Promise<{ handled: boolean; error?: string }> {
  if (!(await isNativeApp())) return { handled: false };

  // CRITICAL graceful-degradation guard.
  //
  // @capacitor/browser's native code is compiled INTO the app
  // binary. The web bundle deploys instantly via taxottic.com, but
  // any already-installed build that predates the plugin has no
  // native Browser implementation — calling Browser.open() there
  // throws "Browser plugin is not implemented on ios", which is
  // STRICTLY WORSE than the old behaviour (it hard-blocks sign-in).
  //
  // isPluginAvailable("Browser") is true only when the running
  // binary actually contains the plugin. If it doesn't, we return
  // { handled: false } so the login page falls back to the standard
  // web redirect — the original imperfect-but-not-erroring flow —
  // until the user installs a rebuilt binary that includes the
  // plugin (at which point the proper custom-scheme flow engages).
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isPluginAvailable("Browser")) {
      return { handled: false };
    }
  } catch {
    return { handled: false };
  }

  // Stash the post-login destination — the custom-scheme redirect
  // must be the EXACT allow-listed URL (no query string), so we
  // can't pass `next` through redirectTo. localStorage survives the
  // round trip because the in-app browser tab and the WebView share
  // the same app sandbox but NOT storage — so we read it back in the
  // appUrlOpen handler which runs in the WebView that set it.
  try {
    if (opts.next) {
      window.localStorage.setItem(NATIVE_NEXT_KEY, opts.next);
    }
  } catch {
    /* private mode / storage disabled — fall back to default next */
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: NATIVE_OAUTH_REDIRECT,
      skipBrowserRedirect: true,
      scopes: opts.scopes,
      queryParams: opts.queryParams,
    },
  });
  if (error) return { handled: true, error: error.message };
  if (!data?.url) {
    return { handled: true, error: "No OAuth URL returned by Supabase." };
  }

  try {
    const { Browser } = await import("@capacitor/browser");
    // presentationStyle popover keeps the iOS dismiss gesture sane;
    // Android ignores it.
    await Browser.open({ url: data.url, presentationStyle: "popover" });
  } catch (e) {
    return {
      handled: true,
      error:
        e instanceof Error
          ? e.message
          : "Could not open the in-app browser for sign-in.",
    };
  }
  return { handled: true };
}

let listenerInstalled = false;

/**
 * Register the global appUrlOpen handler that completes native OAuth.
 * Idempotent — safe to call from a component that may remount.
 * No-ops on web.
 */
export async function installNativeAuthListener(
  supabase: SupabaseClient,
): Promise<void> {
  if (listenerInstalled) return;
  if (!(await isNativeApp())) return;
  listenerInstalled = true;

  const { App } = await import("@capacitor/app");

  await App.addListener("appUrlOpen", async ({ url }) => {
    // Only act on OUR auth callback scheme. Other deep links
    // (Stripe return, Plaid, universal links) pass through untouched.
    if (!url || !url.startsWith(NATIVE_OAUTH_REDIRECT)) return;

    let code: string | null = null;
    let providerError: string | null = null;
    try {
      // Custom-scheme URLs aren't always URL()-parseable across
      // platforms; normalize to https for robust query parsing.
      const u = new URL(url.replace(/^com\.taxottic\.app:\/\//, "https://x/"));
      code = u.searchParams.get("code");
      providerError =
        u.searchParams.get("error_description") ||
        u.searchParams.get("error");
    } catch {
      const m = url.match(/[?&]code=([^&]+)/);
      code = m ? decodeURIComponent(m[1]) : null;
    }

    const finish = async (dest: string) => {
      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.close();
      } catch {
        /* browser may already be closed */
      }
      // Hard navigation so the freshly-set session cookies are
      // picked up by the next request the WebView makes.
      window.location.assign(dest);
    };

    if (providerError && !code) {
      await finish(
        `/login?error=oauth_native&error_description=${encodeURIComponent(
          providerError,
        )}`,
      );
      return;
    }
    if (!code) return;

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    let next = "/dashboard";
    try {
      const stashed = window.localStorage.getItem(NATIVE_NEXT_KEY);
      if (stashed) next = stashed;
      window.localStorage.removeItem(NATIVE_NEXT_KEY);
    } catch {
      /* ignore */
    }

    if (error) {
      await finish(
        `/login?error=exchange_failed&error_description=${encodeURIComponent(
          error.message,
        )}`,
      );
      return;
    }
    await finish(next);
  });
}
