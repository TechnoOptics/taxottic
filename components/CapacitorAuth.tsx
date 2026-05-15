"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { installNativeAuthListener } from "@/lib/capacitor/auth-bridge";

/**
 * Mounted once at the root layout (next to <PWASetup />). On the
 * native Capacitor shell it registers the appUrlOpen listener that
 * completes OAuth inside the WebView (see lib/capacitor/auth-bridge.ts
 * for the full why). On web it is an inert no-op — isNativeApp()
 * returns false and the listener is never installed.
 */
export function CapacitorAuth() {
  useEffect(() => {
    void installNativeAuthListener(createClient());
  }, []);
  return null;
}
