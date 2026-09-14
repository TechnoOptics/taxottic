import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The marketing site, held to the Instrument skin's own rules at source
 * level. Sister to hero-first-screen.test.ts, which covers the home
 * hero's first screen; this file covers what the 2026-09-03 audit
 * ranked next.
 *
 *   1. Brass is static. `gold-shine` is an animated gradient clipped to
 *      text, and `background-clip: text` cannot be composited: the CSS
 *      comment on the class records 271 ms of main-thread paint per
 *      2.5 s of idle for the home page's headline runs. The skin's rule
 *      is brass in one place, and the place is a static token.
 *
 *   2. The navy band is a token. The header and hero gradient was the
 *      same hex literal on twenty-odd pages plus MockupFrame. It now
 *      lives once, under the Instrument skin in app/globals.css, and the
 *      pages reference it by var(). Tailwind v4 `@theme inline` bakes
 *      theme utilities at build time, so the reference has to be an
 *      arbitrary value or an inline style, never a theme utility.
 *
 *   3. Headlines do not orphan or hyphenate. "Yearly saves ~17%." held
 *      "~17%." alone on its own line at 1280 and 375; "self-employed."
 *      split at the hyphen at 1280. Both are wrapping control, not a
 *      hyphen glyph and not smaller type. The rendered outcome is
 *      asserted in e2e/marketing-typography.spec.ts; this pins the
 *      mechanism so a copy edit cannot quietly drop it.
 *
 * Comments are stripped before matching so a rationale in a doc comment,
 * or a commented-out line, cannot satisfy or trip a check.
 */

const ROOT = join(__dirname, "..", "..");
const GLOBALS = "app/globals.css";

function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function read(rel: string): string {
  return code(readFileSync(join(ROOT, rel), "utf8"));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (name === "node_modules") continue;
      walk(rel, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.spec\.tsx?$/.test(name)) {
      out.push(rel);
    }
  }
  return out;
}

const SOURCES = [...walk("app"), ...walk("components")];

describe("brass is static", () => {
  /**
   * The one surviving site. app/c/[publicId]/forecast/page.tsx is the
   * client-facing forecast, part of the authenticated portal that a
   * concurrent PR owns; it was left untouched on purpose and the CSS
   * class stays until it is converted. Remove it from this list, and the
   * class from app/globals.css, in that PR.
   */
  const STILL_ANIMATED = ["app/c/[publicId]/forecast/page.tsx"];

  it("no marketing or product source uses gold-shine", () => {
    const offenders = SOURCES.filter(
      (rel) => !STILL_ANIMATED.includes(rel) && /gold-shine/.test(read(rel)),
    );
    expect(offenders, "replace with text-[var(--kicker)] on paper or text-[var(--accent-2)] on navy").toEqual([]);
  });

  it("the allowlist is real, not stale", () => {
    for (const rel of STILL_ANIMATED) {
      expect(
        /gold-shine/.test(read(rel)),
        `${rel} no longer uses gold-shine: drop it from STILL_ANIMATED and delete the class`,
      ).toBe(true);
    }
  });
});

describe("the navy band is a token", () => {
  const css = read(GLOBALS);

  /** Body of the `[data-skin="instrument"] { ... }` rule. */
  function instrumentSkin(): string {
    const m = /\[data-skin="instrument"\]\s*\{([\s\S]*?)\n\}/.exec(css);
    if (!m) throw new Error(`instrument skin block not found in ${GLOBALS}`);
    return m[1];
  }

  it("declares the three navy stops and the band under the Instrument skin", () => {
    const skin = instrumentSkin();
    // The values the pages carried as literals. Zero visual change is the
    // intent of the tokenisation, so the token must equal the literal.
    expect(skin).toMatch(/--navy-high:\s*#2a3a5e;/);
    expect(skin).toMatch(/--navy:\s*#1d2843;/);
    expect(skin).toMatch(/--navy-deep:\s*#121a2a;/);
    expect(skin).toMatch(
      /--navy-band:\s*linear-gradient\(\s*180deg,\s*var\(--navy-high\)\s*0%,\s*var\(--navy\)\s*60%,\s*var\(--navy-deep\)\s*100%\s*\);/,
    );
  });

  /**
   * Files that must keep a literal, with the reason:
   *   - Satori (next/og ImageResponse) renders no CSS custom properties.
   *   - The native status bar takes a colour value, not a stylesheet.
   *   - The route-level splash has its own stops (50% mid) and a WebView
   *     compositing history; not a marketing surface, left as is.
   */
  const LITERAL_ALLOWED = [
    "app/api/og/calc/route.tsx",
    "app/api/og/guide/route.tsx",
    "app/opengraph-image.tsx",
    "components/CapacitorNativeInit.tsx",
    "app/loading.tsx",
  ];

  it("no page carries the band's hex outside the allowlist", () => {
    const offenders = SOURCES.filter(
      (rel) => !LITERAL_ALLOWED.includes(rel) && /#2a3a5e/i.test(read(rel)),
    );
    expect(offenders, "reference var(--navy-band) or the --navy-* stops").toEqual([]);
  });

  it("the allowlist is real, not stale", () => {
    for (const rel of LITERAL_ALLOWED) {
      expect(/#2a3a5e/i.test(read(rel)), `${rel} no longer needs the literal`).toBe(true);
    }
  });

  it("the audited pages reference the band", () => {
    for (const rel of [
      "components/HeroInstrument.tsx",
      "app/pricing/page.tsx",
      "app/book/page.tsx",
      "app/calculators/page.tsx",
      "app/compare/page.tsx",
    ]) {
      expect(
        /var\(--navy-band\)/.test(read(rel)),
        `${rel} does not use --navy-band (the home page paints navy only on the instrument)`,
      ).toBe(true);
    }
  });
});

describe("headlines hold their last word", () => {
  it("pricing keeps 'Yearly saves ~17%.' on one line", () => {
    const src = read("app/pricing/page.tsx");
    // The figure and the pricing copy are unchanged; only the grouping is.
    expect(src).toMatch(/Honest pricing\./);
    expect(
      /<span className="[^"]*\bwhitespace-nowrap\b[^"]*">\s*Yearly saves ~17%\.\s*<\/span>/.test(src),
      "wrap the phrase in a whitespace-nowrap span, do not shrink the type",
    ).toBe(true);
  });

  it("calculators keeps 'self-employed.' on one line, without a hyphen glyph", () => {
    const src = read("app/calculators/page.tsx");
    expect(
      /<span className="[^"]*\bwhitespace-nowrap\b[^"]*">\s*self-employed\.\s*<\/span>/.test(src),
      "wrap the word in a whitespace-nowrap span",
    ).toBe(true);
    expect(src.includes("self‑employed"), "no non-breaking hyphen glyph").toBe(false);
  });
});
