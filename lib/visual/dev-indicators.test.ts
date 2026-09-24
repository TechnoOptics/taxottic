import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import playwrightConfig from "@/playwright.config";

/**
 * The visual baselines must not contain dev-only chrome.
 *
 * The visual-regression suite runs against `npm run dev` (the webServer
 * block in playwright.config.ts), so anything the dev server paints on top
 * of the app gets committed as though it were product. The Next dev-tools
 * overlay — the dark circular "N", bottom-left — was exactly that: measured
 * on the baselines at 48dc742, it sat in all 32 committed snapshots as a
 * 74x73 region at x1-75, y661-734 (desktop) / y780-853 (mobile).
 *
 * Two things were wrong with that, and only the first is obvious.
 *
 * 1. It is not product. Production never serves it, so a "record of what
 *    the app looks like" that includes it is a record of something else.
 *
 * 2. It flakes, and the gate cannot see the flake. The overlay mounts after
 *    hydration and races the capture, so it painted on some runs and not
 *    others — the entire measured macOS noise floor quoted in
 *    playwright.config.ts came from this one element. Removing it costs at
 *    most 0.502% of a page (compare-hub mobile, the smallest page, counting
 *    every antialiased pixel; pixelmatch discounts AA and charges ~0.43%).
 *    That is under the 1% maxDiffPixelRatio budget on EVERY page, verified
 *    by running the real comparator: badge-free renders against
 *    badge-bearing baselines passed all 16 snapshots.
 *
 * Point 2 is why this test exists rather than trusting CI. If the knob is
 * lost, the overlay comes back, and the `visual` job goes green anyway
 * while every baseline silently re-acquires it. There is no pixel gate to
 * fall back on here; the config IS the guard.
 *
 * Why the config knob and not a `display:none` injected from the spec: the
 * measurement said the knob is strictly better. With `devIndicators: false`
 * the dev-server render is BYTE-IDENTICAL to a production build on all 16
 * snapshots (measured: `next build && next start`, same suite, zero
 * differing pixels). So the baselines are already a faithful record of
 * production rendering, with no build step in the visual job to pay for and
 * no overlay-internal selector for a future Next version to rename out from
 * under us.
 */

describe("dev indicators", () => {
  it("is disabled, so the dev overlay never reaches a screenshot", () => {
    expect(nextConfig.devIndicators).toBe(false);
  });

  // PLAYWRIGHT_BASE_URL points the suite at an already-running server, which
  // drops the webServer block entirely — there is no command to inspect.
  it.skipIf(!!process.env.PLAYWRIGHT_BASE_URL)(
    "still matters, because the visual suite renders via the dev server",
    () => {
      // If the visual job ever builds instead of running `next dev`, the
      // overlay cannot appear and this guard stops being load-bearing. It is
      // load-bearing today: assert the premise rather than assume it.
      const webServer = playwrightConfig.webServer;
      const command = Array.isArray(webServer)
        ? webServer.map((s) => s.command).join(" ")
        : webServer?.command;
      expect(command).toContain("dev");
    },
  );
});
