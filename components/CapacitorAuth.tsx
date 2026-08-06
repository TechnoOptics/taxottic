"use client";

import { useEffect } from "react";
import {
  isNativeApp,
  installNativeAuthListener,
} from "@/lib/capacitor/auth-bridge";

/**
 * Mounted once at the root layout (next to <PWASetup />). On the
 * native Capacitor shell it registers the appUrlOpen listener that
 * completes OAuth inside the WebView (see lib/capacitor/auth-bridge.ts
 * for the full why). On web it is an inert no-op, isNativeApp()
 * returns false and the listener is never installed.
 *
 * PERFORMANCE: `@/lib/supabase/client` is imported dynamically, and only
 * after isNativeApp() has confirmed we are in the Capacitor shell. A
 * static import here put the whole Supabase browser client (GoTrue,
 * postgrest, realtime, phoenix, WebSocket) into the shared chunk set of
 * EVERY route, because this component lives in the root layout. That was
 * 61 KB gzip / 236 KB decoded on every page load including anonymous
 * marketing pages, for a module that web never calls. auth-bridge itself
 * only imports SupabaseClient as a `type`, so it costs nothing at
 * runtime. Measured: shared bundle 261 KB gzip -> 200 KB gzip.
 *
 * Behaviour is unchanged: installNativeAuthListener already began with
 * the same `if (!(await isNativeApp())) return;` guard, so on web the
 * client was constructed and immediately thrown away.
 */
export function CapacitorAuth() {
  useEffect(() => {
    void (async () => {
      if (!(await isNativeApp())) return;
      const { createClient } = await import("@/lib/supabase/client");
      await installNativeAuthListener(createClient());
    })();
  }, []);
  return null;
}
