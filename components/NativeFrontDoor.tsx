"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Client half of the native front door. app/page.tsx only renders for
 * signed-out visitors (signed-in ones are redirected server-side), so on
 * the native shell this page is always the wrong first screen. The
 * middleware handles every launch after the first; this covers the first,
 * before the shell's cookie exists.
 */
export function NativeFrontDoor() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    import("@capacitor/core")
      .then(({ Capacitor }) => {
        if (!cancelled && Capacitor.isNativePlatform()) router.replace("/login");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
