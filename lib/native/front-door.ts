/**
 * The native shell's first screen.
 *
 * The shell loads taxottic.com, so a signed-out launch used to land on
 * the marketing page with Sign in as the third action (both 2026-09-14
 * audits, Critical). The server cannot tell a WebView from Safari, so
 * the shell marks itself: CapacitorNativeInit sets NATIVE_COOKIE on its
 * first run, and the middleware redirects a signed-out request for "/"
 * that carries it. The very first launch, before the cookie exists, is
 * covered by <NativeFrontDoor /> on the client.
 */
export const NATIVE_COOKIE = "taxottic_native";

export function frontDoorRedirect(input: {
  pathname: string;
  hasUser: boolean;
  nativeCookie: boolean;
}): "/login" | null {
  if (input.pathname !== "/") return null;
  if (input.hasUser) return null;
  return input.nativeCookie ? "/login" : null;
}
