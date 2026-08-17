import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A baseline-regeneration run must rewrite EVERY snapshot, not only the
 * ones that currently fail.
 *
 * `--update-snapshots` with no mode resolves to Playwright's `changed`
 * preset (node_modules/playwright/lib/program.js). In that mode the fresh
 * render is compared against the baseline already on disk using the
 * project's `toHaveScreenshot` tolerance, and the file is rewritten ONLY
 * when that comparison fails. A page whose new render passes keeps its
 * OLD baseline, and the regeneration run still reports success.
 *
 * That is not a corner case here. playwright.config.ts leaves pixelmatch's
 * per-pixel `threshold` at its default 0.2, which is a perceptual cutoff
 * of 35215 * 0.2^2 = 1408 in YIQ space. The Instrument skin moved the page
 * ground from #fbf7e9 to #f2f5f8, a delta of about 33. Measured rather
 * than reasoned about: a page painted entirely #f2f5f8 compares EQUAL to a
 * baseline painted entirely #fbf7e9 under this config, with zero pixels
 * reported different.
 *
 * So the redesign was invisible to the comparator on every page whose text
 * also stayed under `maxDiffPixelRatio`, and the manual "visual baselines"
 * workflow produced a MIXED set: home and the mobile pages were rewritten
 * (their heights moved when the display face changed) while pricing and
 * calculators-hub kept cream baselines from the previous design. A mixed
 * set is worse than a stale one, because the gate then passes on two
 * different designs at once.
 *
 * `=all` takes the comparison out of the decision: a regeneration run
 * writes what the app renders, for every snapshot. Playwright still skips
 * the write when the bytes are identical, so this does not churn the diff.
 */
const SCRIPTS: Record<string, string> = JSON.parse(
  readFileSync("package.json", "utf8"),
).scripts;

describe("visual baseline regeneration", () => {
  for (const name of ["e2e:visual:update", "test:ct:update"]) {
    it(`${name} regenerates every snapshot, not only the failing ones`, () => {
      const script = SCRIPTS[name];
      expect(script).toBeTruthy();
      expect(script).toContain("--update-snapshots=all");
    });
  }
});
