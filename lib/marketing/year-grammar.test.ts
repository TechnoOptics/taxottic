import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The Year grammar at source level. The 2026-09-05 audit found the site
 * read as generated because of its grammar, not its palette: eyebrows,
 * chips, italic taglines, mock product windows and stock photographs,
 * repeated on every section. This pins their absence on the home page
 * and in the marketing components, so a later edit cannot bring one back
 * while every other test stays green. Comments are stripped first.
 */
const ROOT = join(__dirname, "..", "..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel: string) => strip(readFileSync(join(ROOT, rel), "utf8"));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec|ct\.spec)\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

/**
 * Every file the home page renders, not just the ones under
 * components/marketing. The nav, the audience switch, the download strip,
 * the wordmark, the store badges and the page's own structured data are
 * all on the home surface, and a retired primitive can come back in any
 * of them.
 */
const HOME = [
  "app/page.tsx",
  "components/HeroInstrument.tsx",
  "components/AudienceToggle.tsx",
  "components/MarketingNav.tsx",
  "components/AppDownloadBanner.tsx",
  "components/Wordmark.tsx",
  "components/AppStoreBadges.tsx",
  "lib/marketing/home-jsonld.ts",
  ...walk("components/marketing"),
];

const RETIRED: [RegExp, string][] = [
  // Matches the class token only; `text-[var(--kicker)]` (the brass token) is allowed.
  [/(^|[\s"'])kicker(-sm)?(?=[\s"'])/m, "eyebrow class"],
  [/tracking-\[0\.(2|32|18)em\]/, "tracked eyebrow"],
  [/\bitalic\b/, "italic tagline"],
  [/gold-shine/, "animated gold"],
  [/Mockup\b|MockupFrame/, "mock product window"],
  [/from "next\/image"/, "photograph"],
  [/rounded-full[^"]*\b(px|py)-/, "pill chip"],
  // The full retired register from the design spec, section 3.
  [/\b(calmer|gentle|gently|quietly|friendly|scary)\b/i, "retired register"],
];

/**
 * One pattern excused for one file, with the reason. Never a whole file:
 * a file waived outright stops guarding the other seven patterns.
 */
const ALLOWED: Record<string, string[]> = {
  // The wordmark is the brand lockup, a pre-rendered PNG of the logo and
  // the name. The pattern exists to keep stock PHOTOGRAPHY off the
  // marketing surface (the audit found four stock photos); it is not a
  // ban on the logo, which every header has to render.
  "components/Wordmark.tsx": ["photograph"],
  // Same lockup rule: the two store badges are Apple's and Google's own
  // supplied artwork, which their brand terms require to be used as-is.
  "components/AppStoreBadges.tsx": ["photograph"],
};

describe("the home page uses the Year grammar", () => {
  for (const rel of HOME) {
    it(`${rel} carries no retired primitive`, () => {
      const src = read(rel);
      const waived = ALLOWED[rel] ?? [];
      for (const [re, what] of RETIRED) {
        if (waived.includes(what)) continue;
        expect(re.test(src), `${rel}: ${what} (${re})`).toBe(false);
      }
    });
  }

  it("the page is composed from the marketing components", () => {
    const page = read("app/page.tsx");
    for (const c of ["MarketingHeader", "HomeHero", "YearSequence", "PriceStrip", "MarketingFooter", "AppDownloadBanner", "YearSpineMotion"]) {
      expect(new RegExp(`<${c}\\b`).test(page), `app/page.tsx does not render <${c}>`).toBe(true);
    }
    for (const gone of ["HeroFigure", "Capabilities", "WhoItsFor", "ProductTour", "ProofBand", "FomoBand", "FinalCta", "function Footer"]) {
      expect(page.includes(gone), `${gone} is still on the page`).toBe(false);
    }
    expect(
      page.length,
      "app/page.tsx should be composition and routing: under 9,000 characters of source, comments stripped",
    ).toBeLessThan(9000);
  });

  it("no photography ships on the marketing surface", () => {
    expect(existsSync(join(ROOT, "public/marketing"))).toBe(false);
  });
});

/* ====================================================================
   Spec section 7: "every date and money figure is inside a `.figure` or
   `.mono` element."

   Source-level, because that is where a regression is introduced: an
   editor writing a note as a plain string. The scan below reads the JSX
   of the home components, finds every money figure and every month-and-day
   date, and asks what element it lands in.

   What is scanned, and what is not:

   - The COMPONENTS, not the copy modules. Strings in
     components/marketing/home-copy.ts and lib/marketing/home-jsonld.ts
     are data: home-copy's dates and amounts are handed to the Screen
     primitives and to HeroInstrument, which render them through
     `.figure` (pinned by lib/marketing/screen-primitives.test.ts), and
     home-jsonld is metadata that is never painted. Scanning them would
     report every one of those as a violation and the guard would have to
     be waived into uselessness. So the rule is enforced where the face is
     actually chosen: in the JSX.

   - Attribute values are allowed only for the primitive props whose
     rendered element carries the face (FIGURE_SLOTS below). Everything
     else, including `note`, `label` and `text`, has to reach the page
     inside an element whose class list carries `figure` or `mono`.

   Mutation-tested 2026-09-07: unwrapping the `$4,610` in YearSequence's
   Q2 note back to `note="was $4,610 on Monday"` fails
   "every money figure and date sits in the data face" naming that file
   and line.
   ==================================================================== */

const MONEY = /\$[\d,]+(?:\.\d\d)?/g;
const DATE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/g;

/**
 * Props whose value the primitive renders in the data face, so a figure
 * passed through one is already correct. Each is pinned by
 * lib/marketing/screen-primitives.test.ts:
 *   value / amount   -> `.figure`         (StatRow, LedgerRow, CategoryBar)
 *   date             -> `.figure`         (LedgerRow)
 *   title / status   -> `.screen-bar mono-label` (Screen)
 *   tag              -> `.tag`, font-family var(--font-data)
 */
const FIGURE_SLOTS = new Set(["value", "amount", "date", "title", "status", "tag"]);

const IDENT_CHAR = /[A-Za-z0-9_$)\]]/;

type Tag = {
  /** "" for a fragment. */
  name: string;
  attrs: string;
  closing: boolean;
  selfClosing: boolean;
  /** Index just past the tag's ">". */
  end: number;
};

/**
 * Read a JSX tag starting at `lt` (the "<"), or null if this "<" is not
 * one. Two things have to be rejected: TypeScript generics
 * (`Record<MomentKey, ReactNode>`, `querySelectorAll<HTMLElement>`) and
 * less-than comparisons.
 *
 * `strict` says we are in CODE, not inside an element's children: there a
 * JSX tag never directly follows an identifier, a closing paren or a
 * closing bracket, which is exactly what a generic's "<" does, so the
 * preceding character settles it. Inside children the rule cannot apply,
 * because `was <span…>` legitimately follows a word. The top-level comma
 * check is a second net for the generics.
 */
function readTag(src: string, lt: number, strict: boolean): Tag | null {
  if (strict) {
    let p = lt - 1;
    while (p >= 0 && /\s/.test(src[p])) p--;
    if (p >= 0 && IDENT_CHAR.test(src[p])) return null;
  }

  let i = lt + 1;
  const closing = src[i] === "/";
  if (closing) i++;
  const nameMatch = /^[A-Za-z][\w.:-]*/.exec(src.slice(i));
  const name = nameMatch ? nameMatch[0] : "";
  if (!name && src[i] !== ">") return null; // not a tag, not a fragment
  i += name.length;

  const attrsStart = i;
  let quote = "";
  let braces = 0;
  let comma = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") { braces++; continue; }
    if (c === "}") { braces--; continue; }
    if (braces > 0) continue;
    if (c === ",") comma = true;
    if (c === ">") break;
  }
  if (i >= src.length) return null;
  if (comma) return null; // a generic argument list, not a tag
  const attrs = src.slice(attrsStart, i);
  return { name, attrs, closing, selfClosing: /\/\s*$/.test(attrs), end: i + 1 };
}

/** The class list an open tag declares, quoted or in a braced expression. */
function classesOf(attrs: string): string {
  const m = /className=(?:"([^"]*)"|\{([\s\S]*?)\}(?=\s|$))/.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "") : "";
}

const inDataFace = (classes: string) => /\bfigure\b/.test(classes) || /\bmono[\w-]*\b/.test(classes);

/**
 * Walk one JSX region and report every money figure or date that is not
 * in the data face.
 *
 * `seed` is the class list the region is rendered into. At the top of a
 * file it is null (no enclosing element yet); for a braced attribute
 * value it is "figure" when the prop is a data-face slot, so
 * `status={<>…</>}` is judged the way `status="…"` is.
 */
function scanRegion(
  rel: string,
  src: string,
  from: number,
  to: number,
  seed: string | null,
): string[] {
  const out: string[] = [];
  const stack: { name: string; classes: string }[] =
    seed === null ? [] : [{ name: "(slot)", classes: seed }];
  const lineOf = (pos: number) => src.slice(0, pos).split("\n").length;

  const scanText = (a: number, b: number, where: (pos: number, hit: string) => string | null) => {
    const text = src.slice(a, b);
    for (const re of [MONEY, DATE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const pos = a + m.index;
        const why = where(pos, m[0]);
        if (why) out.push(`${rel}:${lineOf(pos)}: "${m[0]}" ${why}`);
      }
    }
  };

  let i = from;
  while (i < to) {
    const lt = src.indexOf("<", i);
    const textEnd = lt === -1 || lt >= to ? to : lt;
    // Text between tags: painted by whatever element encloses it.
    scanText(i, textEnd, () => {
      const top = stack[stack.length - 1];
      if (top && inDataFace(top.classes)) return null;
      return `is body-face text inside <${top ? top.name : "no element"}>`;
    });
    if (lt === -1 || lt >= to) break;

    const tag = readTag(src, lt, stack.length === 0);
    if (!tag || tag.end > to) {
      i = lt + 1;
      continue;
    }

    // Attributes. A quoted value is flat text and is judged by the prop
    // it is passed to; a braced value can hold JSX of its own
    // (`note={<>was <span className="figure">$4,610</span>…</>}`), so it
    // is walked as its own region.
    const base = tag.end - 1 - tag.attrs.length;
    const attrRe = /([A-Za-z][\w-]*)=/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(tag.attrs))) {
      const name = am[1];
      const vStart = am.index + am[0].length;
      const open = tag.attrs[vStart];
      if (open === '"' || open === "'") {
        const close = tag.attrs.indexOf(open, vStart + 1);
        if (close === -1) continue;
        scanText(base + vStart + 1, base + close, () =>
          FIGURE_SLOTS.has(name)
            ? null
            : `is in <${tag.name} ${name}=…>, which is not a data-face slot`,
        );
        attrRe.lastIndex = close + 1;
      } else if (open === "{") {
        const close = matchBrace(tag.attrs, vStart);
        if (close === -1) continue;
        out.push(
          ...scanRegion(
            rel,
            src,
            base + vStart + 1,
            base + close,
            FIGURE_SLOTS.has(name) ? "figure" : "",
          ),
        );
        attrRe.lastIndex = close + 1;
      }
    }

    if (tag.closing) stack.pop();
    else if (!tag.selfClosing) stack.push({ name: tag.name || "fragment", classes: classesOf(tag.attrs) });
    i = tag.end;
  }
  return out;
}

/** Index of the "}" closing the "{" at `open`, or -1. Quote-aware. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const figureViolations = (rel: string, src: string) => scanRegion(rel, src, 0, src.length, null);

/** The rendered components: the copy and metadata modules are data (see above). */
const RENDERED = HOME.filter((rel) => rel.endsWith(".tsx"));

describe("the home page sets its figures in the data face", () => {
  it("the scan can see a figure that is in the body face", () => {
    // Guards the guard. A scanner that parses nothing reports nothing, and
    // then the assertion below passes on any source at all. So feed it the
    // exact shape of the regression and check it reports each one, and
    // only those: a body-face prop, body-face element text, and neither of
    // the two forms that are already correct.
    expect(RENDERED.length).toBeGreaterThanOrEqual(8);
    expect(RENDERED).toContain("components/marketing/YearSequence.tsx");

    const probe = [
      "export const Probe = (",
      '  <Screen title="Q3 · due Sep 15" status="10 days">',
      '    <StatRow label="Estimated payment" note="federal $2,760 on Sep 15" value="$3,420" />',
      '    <p className="stat-row-note">was $4,610 on Monday</p>',
      '    <p className="stat-row-note">was <span className="figure">$4,610</span> on Monday</p>',
      "  </Screen>",
      ");",
    ].join("\n");
    const found = figureViolations("probe.tsx", probe).join("\n");

    expect(found, "a money figure in a body-face prop went unreported").toMatch(
      /"\$2,760" is in <StatRow note=…>/,
    );
    expect(found, "a date in a body-face prop went unreported").toMatch(
      /"Sep 15" is in <StatRow note=…>/,
    );
    expect(found, "a money figure in body-face element text went unreported").toMatch(
      /"\$4,610" is body-face text inside <p>/,
    );
    // The data-face slots and the wrapped span are correct: exactly one
    // $4,610 is reported, not two, and title/status/value are never named.
    expect(found.match(/\$4,610/g)).toHaveLength(1);
    expect(found).not.toMatch(/title=|status=|value=/);
  });

  it("every money figure and date sits in the data face", () => {
    const bad: string[] = [];
    for (const rel of RENDERED) bad.push(...figureViolations(rel, read(rel)));
    expect(
      bad,
      "spec section 7: a date or a money figure is rendered in the body face.\n" +
        "Wrap it in <span className=\"figure\">…</span>, or pass it through a\n" +
        "primitive slot that already sets the data face (value, amount, date,\n" +
        "title, status, tag).\n" +
        bad.join("\n"),
    ).toEqual([]);
  });
});
