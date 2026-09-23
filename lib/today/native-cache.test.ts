import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * AppHeader (and therefore TabBar) is rendered per page, not from a shared
 * layout, so `useIsNativeApp` remounts on every client-side navigation. If
 * it restarts from `null` each time, the tab bar blinks out for a frame or
 * more on every tab tap while the dynamic `@capacitor/core` import resolves
 * again. The fix is a module-scope cache that survives the remount: once
 * the native check has run once in this process, later mounts read it
 * synchronously instead of re-importing and waiting.
 *
 * This is a source guard, not a behavioral test, because the component
 * test harness mounts fresh every test and can't observe cross-mount
 * persistence the way a real client-side navigation does.
 */
describe("the native check survives remounts", () => {
  const src = strip(readFileSync("components/MobileOnly.tsx", "utf8"));

  it("caches the native check at module scope and seeds state from it", () => {
    expect(
      src,
      "no module-scope cache for the native check (expected something like `let nativeKnown: boolean | null = null;`)",
    ).toMatch(/let\s+nativeKnown\s*:\s*boolean\s*\|\s*null\s*=\s*null\s*;/);
    expect(
      src,
      "useIsNativeApp must seed its state from the cache on mount, not from null",
      // Whitespace-tolerant: what matters is that the initializer reads
      // the cache, not how the call is spaced or whether the type argument
      // is written with padding.
    ).toMatch(/useState\s*<\s*boolean\s*\|\s*null\s*>\s*\(\s*\(\s*\)\s*=>\s*nativeKnown\s*\)/);
  });

  /**
   * The app runs as a remote WebView, so `import("@capacitor/core")` is a
   * network fetch that can transiently fail. If the catch branch wrote
   * `nativeKnown = false` on that failure, one bad fetch would wrongly
   * remember the whole session as web with no retry, and `WebOnly` would
   * then render checkout/billing controls inside the native app (App
   * Store 3.1.1). The catch branch may still set the local `isNative`
   * state to `false` for that render, but it must leave the shared cache
   * alone so the next mount tries the import again.
   */
  it("never writes the cache from the catch branch, so a failed import retries", () => {
    const catchBody = /\.catch\(\(\)\s*=>\s*\{([\s\S]*?)\}\)/.exec(src)?.[1];
    expect(
      catchBody,
      "could not find the `.catch(() => { ... })` block in useIsNativeApp",
    ).toBeTruthy();
    expect(
      catchBody,
      "the catch branch must not write nativeKnown, a transient import failure has to retry, not be remembered as web",
    ).not.toMatch(/nativeKnown\s*=/);
  });
});
