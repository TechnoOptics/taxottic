import { describe, expect, it } from "vitest";
import pageConfig from "@/playwright.config";
import componentConfig from "@/playwright-ct.config";

/**
 * The visual gate must be able to see a page-ground colour change.
 *
 * Playwright compares screenshots with pixelmatch, which counts a pixel as
 * different only when its YIQ colour distance exceeds
 * `35215 * threshold^2`. Leave `threshold` unset and it defaults to 0.2,
 * a cutoff of 1408. That is roughly forty times larger than the distance
 * between two page grounds a person would call obviously different
 * colours, so a whole-page repaint lands inside the tolerance and the
 * suite reports success.
 *
 * This is not hypothetical. The Instrument skin moved the ground from
 * cream #fbf7e9 to cool paper #f2f5f8. A page painted entirely in the new
 * colour compared EQUAL to an all-cream baseline: zero pixels different.
 * The gate would have passed a full revert of the redesign, and did pass a
 * CI run comparing corrected code against stale cream baselines.
 *
 * Correct baselines are necessary and NOT sufficient — that half is
 * guarded by baseline-regeneration.test.ts. This is the other half: the
 * comparator has to be able to tell the two grounds apart at all.
 *
 * The test re-derives the distance from the two hex values rather than
 * hard-coding "33", so it keeps meaning something if the palette moves
 * again. If a future skin picks two grounds closer together than the
 * current threshold can resolve, this fails and says so, which is the
 * correct moment to find out.
 */

/** pixelmatch's YIQ colour distance, verbatim (pixelmatch's `colorDelta`). */
function yiqDistance(hexA: string, hexB: string): number {
  const rgb = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const yiq = ([r, g, b]: number[]) => [
    r * 0.29889531 + g * 0.58662247 + b * 0.11448223,
    r * 0.59597799 - g * 0.2741761 - b * 0.32180189,
    r * 0.21147017 - g * 0.52261711 + b * 0.31114694,
  ];
  const [y1, i1, q1] = yiq(rgb(hexA));
  const [y2, i2, q2] = yiq(rgb(hexB));
  const dy = y1 - y2;
  const di = i1 - i2;
  const dq = q1 - q2;
  return 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
}

/** The cutoff pixelmatch derives from a `threshold`, in YIQ distance. */
const cutoff = (threshold: number) => 35215 * threshold * threshold;

const CREAM = "#fbf7e9"; // the pre-Instrument ground
const PAPER = "#f2f5f8"; // [data-skin="instrument"] --background, app/globals.css
const PLAYWRIGHT_DEFAULT_THRESHOLD = 0.2;

const CONFIGS: [string, number | undefined][] = [
  ["playwright.config.ts", pageConfig.expect?.toHaveScreenshot?.threshold],
  ["playwright-ct.config.ts", componentConfig.expect?.toHaveScreenshot?.threshold],
];

describe("screenshot comparison threshold", () => {
  it("records why the default threshold is blind to a ground repaint", () => {
    // Not an assertion about our config — an assertion about the trap.
    // ~33 against a cutoff of ~1408.
    expect(yiqDistance(CREAM, PAPER)).toBeLessThan(
      cutoff(PLAYWRIGHT_DEFAULT_THRESHOLD),
    );
  });

  for (const [name, threshold] of CONFIGS) {
    describe(name, () => {
      it("sets an explicit per-pixel threshold", () => {
        expect(threshold).toBeTypeOf("number");
      });

      it("resolves the cream-to-paper ground change", () => {
        expect(cutoff(threshold as number)).toBeLessThan(yiqDistance(CREAM, PAPER));
      });

      it("keeps real margin below that distance, not a hairline", () => {
        // A cutoff sitting just under the distance would be defeated by any
        // slightly nearer pair of colours. Demand at least 2x of headroom.
        expect(cutoff(threshold as number) * 2).toBeLessThan(
          yiqDistance(CREAM, PAPER),
        );
      });
    });
  }
});
