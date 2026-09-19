import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
 * The chrome every one of those pages wears. It is listed rather than
 * reached through the import graph because it is the one part of the
 * surface that is on TWELVE pages at once: a retired primitive here
 * costs twelve times what the same primitive costs on a page, and the
 * footer's brass-era dot survived exactly because no guard read this
 * file.
 */
export const SHARED_SHELL_FILES = [
  "components/marketing/PageShell.tsx",
  "components/marketing/MarketingHeader.tsx",
  "components/marketing/MarketingFooter.tsx",
  "components/MarketingNav.tsx",
];

/**
 * One level of the import graph: the local component files a page
 * actually renders.
 *
 * The guard used to read `page.tsx` and nothing else, and every client
 * component a page mounts was invisible to it. That is not a small gap.
 * `/calculators/self-employment-tax` is a page.tsx of imports and a
 * component that IS the page body, and the body shipped eleven tracked
 * gold eyebrows while the page passed. One level is deliberate: it is
 * the level at which a page chooses what it renders, and it terminates
 * without a cycle check.
 *
 * Resolves `@/components/...` (the tsconfig alias for the repo root) and
 * relative siblings (`./BookForm`), and keeps only `.tsx`, which is what
 * a component is. `@/lib/...` helpers are someone else's guard.
 */
export function childComponentsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
    const resolved = resolveLocalComponent(m[1], file);
    if (resolved && resolved !== file) out.add(resolved);
  }
  return [...out].sort();
}

function resolveLocalComponent(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith("./") || spec.startsWith("../")) base = join(dirname(fromFile), spec);
  else return null; // a package, or an alias this guard does not own.
  for (const candidate of [`${base}.tsx`, join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

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

/**
 * The same eyebrow spelled in CSS instead of utilities.
 *
 * `.mono-label` sets `text-transform: uppercase` and a tracking value in
 * app/globals.css, so an element carrying it is a tracked uppercase
 * label and `tracts()` above, which reads class literals, cannot see it.
 * That is how GuideShell put the eyebrow back on eleven guide pages
 * while passing: the `kicker` to `series` rename moved it past the
 * literal match and the class moved the styling out of the literal.
 *
 * A mono label is legitimate almost everywhere (a ledger row's tag, a
 * spine's date, a footer column head). What spec 4.2 retires is one
 * position: "Headings in wide Archivo, no eyebrow." So the rule is
 * positional, not lexical: a mono-label element whose closing tag is
 * followed by nothing but whitespace and then an `<h1` IS the eyebrow.
 */
function monoLabelEyebrows(src: string): string[] {
  return [
    ...src.matchAll(
      /className="[^"]*\bmono-label\b[^"]*"[^>]*>[\s\S]{0,300}?<\/[A-Za-z][\w.]*>\s*<h1[\s>]/g,
    ),
  ].map((m) => m[0].replace(/\s+/g, " ").trim());
}

/**
 * The retired register from the design spec, section 3. "calm" is the
 * root and was missing, so "Try the calm, no card." shipped as the Free
 * tier's tagline; `calmer` stays spelled out because `\bcalm\b` does not
 * reach it, and `calmly` is the same word in adverb form.
 */
const RETIRED_REGISTER = /\b(calm(er|ly)?|gentle|gently|quietly|friendly|scary)\b/i;

/**
 * Every retired primitive in one file, as findings that name the file.
 * A page's finding list is this run over the page AND over the
 * components it renders, so a failure message points at the file that
 * has to change rather than at the page that happens to import it.
 */
function retiredPrimitivesIn(file: string): string[] {
  const src = strip(readFileSync(file, "utf8"));
  const found: string[] = [];
  const hit = (re: RegExp, what: string) => {
    const m = src.match(re);
    if (m) found.push(`${file}: ${what} (${m[0].trim().slice(0, 60)})`);
  };
  hit(/\bkicker\b|kicker-sm|gold-shine|text-gold-|bg-gold-|border-gold-|ring-gold-/, "a gold primitive");
  for (const t of tracts(src)) found.push(`${file}: a tracked uppercase eyebrow ("${t}")`);
  for (const e of monoLabelEyebrows(src)) {
    found.push(`${file}: a mono-label eyebrow directly above an h1 (${e.slice(0, 60)})`);
  }
  hit(/rounded-full/, "a pill or a dot");
  hit(/\bitalic\b|<em\b|<i\b/, "an italic");
  hit(/&rarr;|→/, "an arrow");
  hit(RETIRED_REGISTER, "a retired register word");
  return found;
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
    it(`${file} carries no retired primitive, in itself or in what it renders`, () => {
      const tree = [file, ...childComponentsOf(file)];
      expect(
        tree.flatMap(retiredPrimitivesIn),
        `the page and the ${tree.length - 1} local component(s) it renders: ` +
          "a tracked uppercase eyebrow (utility classes OR .mono-label above " +
          "an h1), a gold primitive, a pill or dot, an italic, an arrow, or a " +
          "retired register word. The live label primitive is `mono-label`, " +
          "anywhere but directly above the h1.",
      ).toEqual([]);
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
      it("GuideShell says the series once, as the breadcrumb's last crumb", () => {
        // Two renderings of the same string, the crumb and an eyebrow
        // over the h1, is the eyebrow spec 4.2 retires wearing the
        // breadcrumb's words. The crumb is the one that carries meaning
        // (it mirrors the BreadcrumbList JSON-LD), so it is the one
        // that stays.
        expect(count(src, /\{series\}/g), "the series renders once").toBe(1);
        expect(src).toMatch(/aria-label="Breadcrumb"[\s\S]*\{series\}[\s\S]*<h1/);
      });
    }
  }

  it("the shared shell carries no retired primitive", () => {
    expect(SHARED_SHELL_FILES.flatMap(retiredPrimitivesIn)).toEqual([]);
  });
});

/**
 * The guard guarding itself.
 *
 * Every claim this file makes rests on `childComponentsOf` actually
 * reaching a page's children, and a resolver that silently returns
 * nothing reads exactly like a clean surface. So the resolver is run
 * against a planted fixture: a page that imports a child, and a child
 * carrying the eyebrow. The fixture lives in a tmp dir and is never
 * committed; if it were part of the repo the same sweep that fixes a
 * real page would eventually "fix" it and the self-test would go quiet.
 */
describe("the guard can see into a page's components", () => {
  const dir = mkdtempSync(join(tmpdir(), "page-grammar-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const pageFile = join(dir, "page.tsx");
  const childFile = join(dir, "PlantedChild.tsx");
  writeFileSync(
    pageFile,
    'import { PlantedChild } from "./PlantedChild";\n' +
      "export default function Page() {\n  return <PlantedChild />;\n}\n",
  );
  writeFileSync(
    childFile,
    "export function PlantedChild() {\n" +
      '  return <p className="text-[10px] uppercase tracking-[0.28em] text-gold-700">Your numbers</p>;\n' +
      "}\n",
  );

  it("resolves a relative child import", () => {
    expect(childComponentsOf(pageFile)).toEqual([childFile]);
  });

  it("reports the child's eyebrow, and names the child file", () => {
    const findings = [pageFile, ...childComponentsOf(pageFile)].flatMap(retiredPrimitivesIn);
    expect(findings, "the planted eyebrow went unseen").not.toEqual([]);
    // The message has to name the file that has to change. A finding
    // that says only "this page fails" sends the reader to a page.tsx
    // of imports, which is where the calculator sweep stalled.
    expect(findings.join("\n")).toContain("PlantedChild.tsx");
    expect(findings.join("\n")).toContain("a tracked uppercase eyebrow");
    expect(findings.every((f) => !f.startsWith(pageFile))).toBe(true);
  });

  it("says nothing once the child is clean", () => {
    writeFileSync(
      childFile,
      "export function PlantedChild() {\n  return <p className=\"mono-label\">Your numbers</p>;\n}\n",
    );
    expect([pageFile, ...childComponentsOf(pageFile)].flatMap(retiredPrimitivesIn)).toEqual([]);
  });
});

/**
 * The positional half of the eyebrow rule, planted the same way: a
 * `.mono-label` is legitimate until it sits directly above an h1.
 */
describe("a mono-label directly above an h1 is an eyebrow", () => {
  const above =
    '<p className="mono-label mt-6">{series}</p>\n<h1 className="display">Title</h1>';
  const beside =
    '<h1 className="display">Title</h1>\n<p className="mono-label mt-6">{series}</p>';

  it("fires on the label above the heading", () => {
    expect(monoLabelEyebrows(above)).toHaveLength(1);
  });
  it("stays quiet on a label anywhere else", () => {
    expect(monoLabelEyebrows(beside)).toEqual([]);
    expect(monoLabelEyebrows('<span className="mono-label">Shipped</span>')).toEqual([]);
  });
  it("is what `tracts()` alone cannot see", () => {
    // `.mono-label` sets uppercase and tracking in CSS, so no class
    // literal carries both and the utility-class check reads clean.
    expect(tracts(above)).toEqual([]);
  });
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

describe("the index pages are ledger lists", () => {
  for (const file of ["app/calculators/page.tsx", "app/guides/page.tsx", "app/compare/page.tsx", "app/changelog/page.tsx"]) {
    it(`${file} renders its list through LedgerList and no card grid`, () => {
      const src = strip(readFileSync(file, "utf8"));
      expect(src).toMatch(/<LedgerList\b/);
      expect(src).not.toMatch(/grid gap-4|grid-cols-2 gap-3|surface surface-hover/);
    });
  }
  it("the changelog puts the date in the data face and tags in mono labels", () => {
    const src = strip(readFileSync("app/changelog/page.tsx", "utf8"));
    expect(src).toMatch(/date: formatEntryDate\(/);
    expect(src).not.toMatch(/TAG_TONE|px-2 py-0\.5/);
  });
});
