import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Source with its comments removed. Line comments go FIRST: a `//` line
 * that mentions a path like `/admin/**` otherwise opens a phantom block
 * comment that runs to the next `*\/`, swallowing live markup in
 * between (that is exactly what hid /login's wrapper from this guard).
 */
const strip = (s: string) =>
  s
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pagesUnder(p));
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

/** Every public marketing page in the Year grammar (spec 4.2). */
export const PUBLIC_MARKETING_PAGES = [
  ...pagesUnder("app/pricing"),
  ...pagesUnder("app/calculators"),
  ...pagesUnder("app/guides"),
  ...pagesUnder("app/compare"),
  "app/help/page.tsx",
  "app/changelog/page.tsx",
  "app/book/page.tsx",
  "app/get/page.tsx",
  "components/guides/GuideShell.tsx",
].sort();

/**
 * Class strings, one literal at a time. A className is sometimes a
 * concatenation (`"a b " + TONE[t]`), so testing the whole file for
 * `uppercase` and for a tracking value separately would fire on two
 * unrelated elements; testing each literal keeps the AND honest.
 */
function classLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** The tracked eyebrow, at any tracking value and in either class order. */
function tracts(src: string): string[] {
  return classLiterals(src).filter(
    (v) => /\buppercase\b/.test(v) && /tracking-\[0?\.\d+em\]/.test(v),
  );
}

const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

/**
 * The nav key each page must pass to the shell. A page that is IN the
 * nav has to light its own item; the two off-nav pages (/get, /book)
 * must pass no key at all, or they light someone else's.
 */
function expectedCurrent(file: string): string | null {
  if (file === "components/guides/GuideShell.tsx") return "guides";
  if (file.startsWith("app/pricing/")) return "pricing";
  if (file.startsWith("app/calculators/")) return "calculators";
  if (file.startsWith("app/compare/")) return "compare";
  if (file === "app/guides/page.tsx") return "guides";
  if (file === "app/help/page.tsx") return "help";
  if (file === "app/changelog/page.tsx") return "changelog";
  return null; // app/get, app/book: deliberately off-nav.
}

describe("the secondary marketing pages are in the Year grammar", () => {
  it("covers the pages the spec names", () => {
    expect(PUBLIC_MARKETING_PAGES.length).toBeGreaterThanOrEqual(30);
  });
  for (const file of PUBLIC_MARKETING_PAGES) {
    const src = strip(readFileSync(file, "utf8"));
    const isShell = file.endsWith("GuideShell.tsx");
    const isGuidePage = file.startsWith("app/guides/") && file !== "app/guides/page.tsx";
    it(`${file} uses the shell and carries the grammar attribute`, () => {
      if (isGuidePage) {
        expect(src).toMatch(/<GuideShell/);
      } else {
        expect(src).toMatch(/<PageShell/);
        expect(src).toMatch(/data-grammar="year"/);
      }
      expect(src).not.toMatch(/var\(--navy-band\)/);
      expect(src).not.toMatch(/<MarketingNav\b/);
      expect(src).not.toMatch(/<SignInIconLink\b/);
    });
    it(`${file} carries no retired primitive`, () => {
      expect(src).not.toMatch(/\bkicker\b|kicker-sm|gold-shine|text-gold-|bg-gold-|border-gold-|ring-gold-/);
      expect(
        tracts(src),
        "a tracked uppercase eyebrow, at any tracking value and in either " +
          "class order. The live primitive is `mono-label`.",
      ).toEqual([]);
      expect(src).not.toMatch(/rounded-full/);
      expect(src).not.toMatch(/\bitalic\b/);
      expect(src).not.toMatch(/&rarr;|→/);
      expect(src).not.toMatch(/\b(calmer|gentle|gently|quietly|friendly|scary)\b/i);
    });
    it(`${file} mounts one shell and renders no chrome of its own`, () => {
      // One shell, opened and closed once. Two shells means two headers,
      // two spines and two footers; a stray </PageShell> means the page
      // below it escaped the shell entirely.
      if (isGuidePage) {
        expect(count(src, /<GuideShell\b/g), "one GuideShell per guide").toBe(1);
      } else {
        expect(count(src, /<PageShell\b/g), "one PageShell per page").toBe(1);
        expect(count(src, /<\/PageShell>/g), "one closing PageShell").toBe(1);
      }
      // The shell owns the header and the footer. A page that renders its
      // own gets two of them, which is the state this sweep removed.
      expect(src, "the shell owns the header").not.toMatch(/<header\b/);
      expect(src, "the shell owns the footer").not.toMatch(/<footer\b/);
    });

    if (!isGuidePage) {
      const want = expectedCurrent(file);
      it(`${file} passes the shell ${want ? `current="${want}"` : "no nav key"}`, () => {
        const keys = [...src.matchAll(/current="([^"]*)"/g)].map((m) => m[1]);
        if (want) {
          expect(keys, `the nav item for ${want} would never light`).toEqual([want]);
        } else {
          expect(keys, "an off-nav page must not light another page's item").toEqual([]);
        }
      });
    }

    if (isShell) {
      it("GuideShell mounts the shell for every guide", () => {
        expect(src).toMatch(/<PageShell current="guides"/);
      });
    }
  }
});

describe("help and login", () => {
  it("help's quickstart is a numbered ledger (a real sequence) and its FAQ is hairline rows", () => {
    const src = strip(readFileSync("app/help/page.tsx", "utf8"));
    expect(src).toMatch(/<ol className="quickstart"/);
    expect(src).not.toMatch(/grid gap-4 sm:grid-cols-3/);
    // The rows are the shared component (Task 3's restyle, one copy for
    // /pricing and /help), so the row class is asserted where it is
    // declared rather than re-typed at every call site.
    expect(src).toMatch(/<Faq\b/);
    expect(
      strip(readFileSync("components/marketing/Faq.tsx", "utf8")),
    ).toMatch(/className="faq-row/);
  });
  it("login sits on paper under the grammar with no navy", () => {
    const src = strip(readFileSync("app/login/page.tsx", "utf8"));
    expect(src).toMatch(/data-grammar="year"/);
    expect(src).not.toMatch(/navy|bg-forest-9|text-cream/);
  });
});
