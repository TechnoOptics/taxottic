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
    ).toMatch(/useState<boolean \| null>\(\(\) => nativeKnown\)/);
  });
});
