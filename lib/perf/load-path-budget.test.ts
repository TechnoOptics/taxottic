import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";

/**
 * Budgets for the assets on the mobile cold-start critical path.
 *
 * Why this file exists: the native app is a Capacitor shell whose
 * WebView loads the REMOTE production URL (see capacitor.config.ts,
 * `server.url`). There is no local bundle, so every cold start is a
 * full network page load. Anything the browser fetches at high
 * priority before first paint is paid on every launch, on a phone, on
 * a mobile network.
 *
 * Both budgets below guard a regression that is completely invisible in
 * review: an asset gets bigger, or a font goes back to being preloaded,
 * and nothing breaks, nothing errors, the page just gets slower. The
 * only signal is a number, so the number is asserted here.
 */

/**
 * Source with comments removed.
 *
 * Load-bearing, and not a formality. This repo has shipped guards that
 * matched the prose EXPLAINING a problem and reported it as the problem
 * fixed. `app/loading.tsx` opens with a comment that names the brand
 * mark, and `app/layout.tsx` carries paragraphs of commentary about the
 * typefaces, so a raw-text assertion here would be satisfied by the
 * documentation regardless of what the code does.
 */
function withoutComments(src: string): string {
  let out = "";
  let inString = false;
  let quote = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (!inString && two === "//") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (!inString && two === "/*") {
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    const ch = src[i];
    if (!inString && (ch === '"' || ch === "'" || ch === "`")) {
      inString = true;
      quote = ch;
    } else if (inString && ch === quote && src[i - 1] !== "\\") {
      inString = false;
      quote = "";
    }
    out += ch;
    i++;
  }
  return out;
}

describe("cold-start critical path budgets", () => {
  /**
   * The loading screen is the FIRST thing a cold-starting user sees
   * once the 1.5 s native splash times out, and its brand mark is
   * emitted as `<link rel="preload" as="image">` at the very top of
   * every route's <head>. It is therefore the highest-priority fetch
   * of the entire cold start.
   *
   * It regressed to a 512x512 PNG base64-embedded inside an SVG
   * wrapper: 39,754 bytes on disk, 29,699 bytes on the wire after
   * brotli, to paint a mark that `app/loading.tsx` sizes at 96 CSS
   * pixels. The budget below is comfortably above a correctly sized
   * 3x asset (96 * 3 = 288 px) and comfortably below the regression,
   * so it fails if anyone points this back at a full-resolution mark.
   */
  it("keeps the loading-screen brand mark under 20 KB", () => {
    const src = withoutComments(readFileSync("app/loading.tsx", "utf8"));
    const ref = /src=\{?"(\/brand\/[^"]+)"/.exec(src);
    expect(
      ref,
      "app/loading.tsx no longer references a /brand/ asset; update this guard",
    ).not.toBeNull();

    const bytes = statSync(`public${ref![1]}`).size;
    expect(
      bytes,
      `${ref![1]} is ${bytes} bytes; it is preloaded at highest priority on ` +
        `every cold start to paint a 96px mark`,
    ).toBeLessThanOrEqual(20 * 1024);
  });

  /**
   * Fraunces is the display face for `[data-skin="classic"]`, which is
   * ONLY /firm and /admin (app/globals.css). Every other surface,
   * including every screen the mobile app shows, runs
   * `[data-skin="instrument"]` and uses Archivo instead.
   *
   * Measured on the built app shell: five woff2 files totalling 126,276
   * bytes are fetched on /example, while only Hanken Grotesk and
   * Archivo ever resolve against an element. Preloading Fraunces spends
   * 36,860 bytes of high-priority bandwidth on a typeface the mobile
   * app never draws.
   *
   * `preload: false` does not remove the font. The @font-face stays, so
   * /firm and /admin still get Fraunces, fetched when the CSS actually
   * matches, under the `display: "swap"` this file already sets.
   */
  it("does not preload Fraunces, which the mobile app never renders", () => {
    const src = withoutComments(readFileSync("app/layout.tsx", "utf8"));
    const call = /Fraunces\(\{([\s\S]*?)\}\)/.exec(src);
    expect(
      call,
      "app/layout.tsx no longer calls Fraunces({...}); update this guard",
    ).not.toBeNull();

    const config = call![1].replace(/\s+/g, "");
    expect(
      config,
      "Fraunces must be declared preload:false so it is not fetched on " +
        "routes that render Archivo",
    ).toContain("preload:false");
  });
});
