# The secondary marketing pages and shell (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every public marketing page gets the paper header with a static year spine and the paper footer, and its content moves into the Year grammar: wide headings with no eyebrow, ledger lists instead of card grids, the pricing tiers as one ruled table, the changelog as dated rows, the book and help pages without chips.

**Architecture:** One shell, `components/marketing/PageShell.tsx`, composes the existing `MarketingHeader` (with a static paper `YearSpine` in its slot), the page's children, and `MarketingFooter`. Nineteen pages that carry an identical inline navy `<header>` block, plus the eleven guides through `components/guides/GuideShell.tsx`, swap that block for the shell; their `<main>` gains `data-grammar="year"` so the wide display setting applies. A `LedgerList` primitive renders every index list. The pricing tiers become a table on `sm` and up and a stacked ledger below. Guards: no page paints the navy band, every public page carries the grammar attribute, no retired primitive survives on those pages. Every public visual baseline is regenerated (Darwin and Linux) because every page changes.

**Tech Stack:** Next.js 16 (App Router, server components), React 19, Tailwind v4, vitest, Playwright (e2e and component tests).

Spec: `docs/superpowers/specs/2026-09-05-year-interface-design.md` sections 3, 4.1 items 1 and 7, and 4.2. The login page's 4.2 items were delivered by PR #634 (passkey first, Send code, 44px controls); this PR moves it onto paper.

## Global Constraints

- No em dashes (U+2014) anywhere: code, comments, copy, commit messages, PR text. No emoji. Icons only from `components/ui/Icons`.
- Copy register: plain, specific, present tense; never "calmer, gentle, gently, quietly, friendly, scary"; no italics; the h1 says what the eyebrow used to say. No new claims: prices from `PLAN_PRICING` only, every FAQ answer and JSON-LD string unchanged in meaning.
- Every date and money figure in `figure`. Brass only on today's marker (in the spine); the "Yearly saves ~17%" span on the pricing h1 keeps `text-[var(--kicker)]` as #631 set it (recorded exception).
- Retired on these pages: `kicker`, `text-xs uppercase tracking-[0.2em] text-gold-700` eyebrows, `rounded-full` chips, `gold-shine`, `text-gold-*`/`bg-gold-*`/`border-gold-*`, italic taglines, the inline navy header, the "→" arrow suffix on links.
- Navy only on the instrument panel. The status-bar band follows the page (PR #634); paper pages set nothing.
- Headings: one `h1` per page, in `.display` under `data-grammar="year"`; the spine is static (no `YearSpineMotion`) with the sample date `HOME_AS_OF` and `HOME_TAX_YEAR` from `components/marketing/home-copy.ts` so baselines do not drift.
- Structured data (JSON-LD), metadata, canonical links and the sitemap are unchanged; `e2e/sitemap-public.spec.ts` must keep passing.
- Tap targets 44px on phones for every control this plan touches. No horizontal overflow at 344.
- `CACHE_VERSION` in `public/sw.js` bumped in Task 7, chosen against `origin/main` and every open PR at the moment of the bump, keeping every entry.
- Gates before every commit: `npx tsc --noEmit` clean; `npx eslint . --ignore-pattern 'playwright/.cache/**'` 0 errors and the base's warning count (45); `npx vitest run` green; the component suite green with no snapshot change; the e2e specs a task names.
- Commit messages end with the exact trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and nothing after it.
- Branch `feat/marketing-pages`, worktree `/Users/technooptics/Projects/taxottic-wt/marketing-pages`, stacked on `feat/today-screen` (PR #635). Never use bare `git stash`.

---

### Task 1: PageShell and LedgerList

**Files:**
- Create: `components/marketing/PageShell.tsx`, `components/marketing/LedgerList.tsx`, `components/marketing/LedgerList.ct.spec.tsx`, `lib/marketing/page-shell.test.ts`
- Modify: `components/MarketingNav.tsx` (`NavKey` gains `"help" | "changelog" | "compare"` so `current` can be passed for those pages; the nav still renders only Pricing, Guides, Calculators), `components/marketing/MarketingHeader.tsx` (`current` type widened to `NavKey`), `app/globals.css` (`.ledger-list` block)

**Interfaces:**
- Produces:
  - `PageShell({ current?: NavKey; cta?: { href: string; label: string }; children })`: renders `<MarketingHeader current cta spine={<YearSpine taxYear={HOME_TAX_YEAR} asOf={HOME_AS_OF} variant="paper" id="page-spine" />} />`, then `{children}`, then `<MarketingFooter />`. The default `cta` is `{ href: "/example", label: "See the sample account" }`.
  - `LedgerList({ items: { href: string; title: string; blurb?: string; date?: string; figure?: string; tag?: string }[]; ariaLabel: string })`: a `<ul>` of hairline rows; each row is one `<a>` (44px minimum) with the title, an optional blurb beneath, and an optional mono column at the right (`date` or `figure` in `figure`, `tag` in `mono-label`).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/marketing/page-shell.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the page shell", () => {
  const src = strip(readFileSync("components/marketing/PageShell.tsx", "utf8"));
  it("composes the paper header with a static sample spine, the children and the footer", () => {
    expect(src).toMatch(/<MarketingHeader[\s\S]*current=\{current\}[\s\S]*spine=\{/);
    expect(src).toMatch(/<YearSpine[^>]*taxYear=\{HOME_TAX_YEAR\}[^>]*asOf=\{HOME_AS_OF\}[^>]*variant="paper"/);
    expect(src).not.toMatch(/YearSpineMotion/);
    expect(src.indexOf("{children}")).toBeGreaterThan(src.indexOf("<MarketingHeader"));
    expect(src.indexOf("<MarketingFooter")).toBeGreaterThan(src.indexOf("{children}"));
  });
  it("widens the nav's current key without adding nav items", () => {
    const nav = strip(readFileSync("components/MarketingNav.tsx", "utf8"));
    expect(nav).toMatch(/type NavKey = "pricing" \| "guides" \| "calculators" \| "help" \| "changelog" \| "compare"/);
    expect(nav.match(/\{ key: "/g)?.length).toBe(3);
  });
});
```

```tsx
// components/marketing/LedgerList.ct.spec.tsx
import { test, expect } from "@playwright/experimental-ct-react";
import { LedgerList } from "./LedgerList";

const items = [
  { href: "/guides/a", title: "How much should I set aside for taxes when self-employed?", blurb: "A simple way to size your tax set-aside." },
  { href: "/changelog#x", title: "Tick the rows you mean", date: "Aug 6, 2026", tag: "Shipped" },
  { href: "/pricing#solo", title: "Solo", blurb: "Freelancer or sole proprietor.", figure: "$19.99" },
];

for (const width of [344, 1280]) {
  test(`rows are hairline-separated, 44px, with the mono column in the data face at ${width}`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mount(
      <div data-skin="instrument" data-grammar="year" style={{ padding: 16 }}>
        <LedgerList items={items} ariaLabel="Guides" />
      </div>,
    );
    const links = page.getByRole("link");
    await expect(links).toHaveCount(3);
    for (const l of await links.all()) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const figures = await page.locator(".figure").allTextContents();
    expect(figures).toEqual(expect.arrayContaining(["Aug 6, 2026", "$19.99"]));
    const tag = page.locator(".mono-label", { hasText: "Shipped" });
    expect(await tag.evaluate((e) => getComputedStyle(e).textTransform)).toBe("uppercase");
    const rowBorder = await page.locator("li").first().evaluate((e) => getComputedStyle(e).borderBottomWidth);
    expect(rowBorder).toBe("1px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
```

Run: `npx vitest run lib/marketing/page-shell.test.ts && npx playwright test -c playwright-ct.config.ts components/marketing/LedgerList.ct.spec.tsx`
Expected: FAIL (modules missing; NavKey unchanged).

- [ ] **Step 2: Implement**

```tsx
// components/marketing/PageShell.tsx
import type { ReactNode } from "react";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { YearSpine } from "@/components/marketing/YearSpine";
import { HOME_AS_OF, HOME_TAX_YEAR } from "@/components/marketing/home-copy";
import type { NavKey } from "@/components/MarketingNav";

/**
 * The shell every secondary marketing page shares (spec 4.2): the paper
 * header with a static sample spine in its slot, the page, the footer.
 * Static means no YearSpineMotion: the fill sits at the sample date so
 * the visual baselines do not drift.
 */
export function PageShell({ current, cta, children }: { current?: NavKey; cta?: { href: string; label: string }; children: ReactNode }) {
  return (
    <>
      <MarketingHeader
        current={current}
        cta={cta ?? { href: "/example", label: "See the sample account" }}
        spine={<YearSpine taxYear={HOME_TAX_YEAR} asOf={HOME_AS_OF} variant="paper" id="page-spine" />}
      />
      {children}
      <MarketingFooter />
    </>
  );
}
```

`NavKey` must be exported from `components/MarketingNav.tsx` (`export type NavKey = ...`); widen it as the test says and change `MarketingHeader`'s `current?:` to `NavKey`.

```tsx
// components/marketing/LedgerList.tsx
import Link from "next/link";

export type LedgerItem = { href: string; title: string; blurb?: string; date?: string; figure?: string; tag?: string };

/** Spec 4.2: card lists become ledger lists. The title is the link. */
export function LedgerList({ items, ariaLabel }: { items: LedgerItem[]; ariaLabel: string }) {
  return (
    <ul className="ledger-list" aria-label={ariaLabel}>
      {items.map((it) => (
        <li key={it.href} className="ledger-list-row">
          <Link href={it.href} className="ledger-list-link">
            <span className="ledger-list-main">
              <span className="ledger-list-title">{it.title}</span>
              {it.blurb ? <span className="ledger-list-blurb">{it.blurb}</span> : null}
            </span>
            {it.date || it.figure || it.tag ? (
              <span className="ledger-list-aside">
                {it.date ? <span className="figure">{it.date}</span> : null}
                {it.figure ? <span className="figure">{it.figure}</span> : null}
                {it.tag ? <span className="mono-label">{it.tag}</span> : null}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

Append to `app/globals.css` after the `.tab-bar` block:

```css
/* ---- YEAR GRAMMAR: ledger lists (spec 4.2) ---- */
[data-skin="instrument"] .ledger-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); }
[data-skin="instrument"] .ledger-list-row { border-bottom: 1px solid var(--border); }
[data-skin="instrument"] .ledger-list-link { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; min-height: 44px; padding: 14px 0; color: var(--foreground); text-decoration: none; }
[data-skin="instrument"] .ledger-list-link:hover .ledger-list-title { text-decoration: underline; text-underline-offset: 3px; }
[data-skin="instrument"] .ledger-list-link:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
[data-skin="instrument"] .ledger-list-main { display: grid; gap: 4px; min-width: 0; }
[data-skin="instrument"] .ledger-list-title { font-size: 1.0625rem; line-height: 1.35; font-weight: 500; }
[data-skin="instrument"] .ledger-list-blurb { font-size: 0.9375rem; line-height: 1.5; color: var(--muted); }
[data-skin="instrument"] .ledger-list-aside { display: grid; gap: 4px; justify-items: end; flex-shrink: 0; text-align: right; font-size: 0.875rem; color: var(--muted); }
```

- [ ] **Step 3: Run the tests, tsc, lint**

Run: `npx vitest run lib/marketing && npx playwright test -c playwright-ct.config.ts components/marketing/LedgerList.ct.spec.tsx && npx tsc --noEmit && npx eslint components/marketing components/MarketingNav.tsx`
Expected: PASS (the wider `NavKey` breaks nothing: no caller passes an unlisted key).

- [ ] **Step 4: Commit**

```bash
git add components/marketing/PageShell.tsx components/marketing/LedgerList.tsx components/marketing/LedgerList.ct.spec.tsx lib/marketing/page-shell.test.ts components/MarketingNav.tsx components/marketing/MarketingHeader.tsx app/globals.css
git commit -m "PageShell and LedgerList: the paper chrome and the list every secondary page will use"
```

---

### Task 2: The shell sweep, the guards, and the guides

**Files:**
- Modify: the nineteen pages that carry the inline navy header (`app/pricing/page.tsx`, `app/calculators/page.tsx` and its nine subpages `1099-tax`, `effective-tax-rate`, `how-much-to-set-aside`, `mileage-deduction`, `mileage-log`, `mileage-reimbursement`, `quarterly-estimated-tax`, `self-employment-tax`, `self-employment-tax/[state]`, `self-employment-tax/on/[amount]`, `app/changelog/page.tsx`, `app/compare/page.tsx` and its two subpages, `app/get/page.tsx`, `app/guides/page.tsx`, `app/help/page.tsx`), `components/guides/GuideShell.tsx` (the eleven guides), `app/book/page.tsx` (its own smaller header), `lib/marketing/marketing-skin.test.ts` (the "audited pages reference the band" assertion inverts), `e2e/public-marketing.spec.ts` and `e2e/help-pricing.spec.ts` (any assertion on the old header)
- Create: `lib/marketing/page-grammar.test.ts`

**Interfaces:**
- Consumes: `PageShell` from Task 1.
- Produces: every public marketing page renders `<PageShell current=...>` as the outermost element inside `<main data-grammar="year" ...>`, with the old `<header ...>` block removed and, where a page rendered its own `<footer>` (pricing does; check each), that footer removed in favour of the shell's.

- [ ] **Step 1: Write the failing guard**

```ts
// lib/marketing/page-grammar.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

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
      expect(src).not.toMatch(/uppercase tracking-\[0\.(2|18|28|32)em\]/);
      expect(src).not.toMatch(/rounded-full/);
      expect(src).not.toMatch(/\bitalic\b/);
      expect(src).not.toMatch(/&rarr;|→/);
      expect(src).not.toMatch(/\b(calmer|gentle|gently|quietly|friendly|scary)\b/i);
    });
    if (isShell) {
      it("GuideShell mounts the shell for every guide", () => {
        expect(src).toMatch(/<PageShell current="guides"/);
      });
    }
  }
});
```

Run: `npx vitest run lib/marketing/page-grammar.test.ts`
Expected: FAIL on every page (navy header present, no `PageShell`).

- [ ] **Step 2: Sweep the nineteen pages**

For each page in the list (not the guide pages, which go through `GuideShell`):

1. Delete the `<header ...>` element whose `style` carries `var(--navy-band)` (from `<header` to its matching `</header>`, including the hairline `<div aria-hidden="true" ...>` inside it) and the imports it alone used (`MarketingNav`, `SignInIconLink`, `Wordmark` if unused elsewhere in the file).
2. Import `PageShell` from `@/components/marketing/PageShell` and wrap the page body: `<main data-grammar="year" className="min-h-screen bg-[var(--color-cream)]"><PageShell current="pricing">...existing sections...</PageShell></main>`. `current` is `"pricing"`, `"calculators"` (every calculators page), `"guides"`, `"compare"` (compare pages), `"help"`, `"changelog"`; omit it on `/get` and `/book`.
3. If the page renders its own `<footer>`, delete it (the shell's `MarketingFooter` replaces it). Keep every `<JsonLd>` and every section.
4. Replace each eyebrow `<div className="text-xs uppercase tracking-[0.2em] text-gold-700">Label</div>` above an `h1`: delete it; if the eyebrow said something the h1 does not (Guides: "Free guides"; Changelog: "What changed"; Help: "Help and FAQ"), fold it into the h1 text or a plain lede under the h1. The `h1` keeps `display` and gets `text-4xl sm:text-6xl` (the wide setting applies under the attribute).
5. Replace any `&rarr;` or `→` link suffix with nothing; the link text stands alone ("Open the calculator", "Read the guide").
6. `app/book/page.tsx`: its own header (wordmark plus "Back to home") becomes `<PageShell>` with no `current`; the three `Reassurance` items lose `kicker` and render as a `LedgerList`-style plain list (title and body), using `mono-label` for the title.
7. `app/get/page.tsx` (the token download page): the shell with no `current`; its content unchanged.

- [ ] **Step 3: The guides**

In `components/guides/GuideShell.tsx`, replace its navy header block the same way with `<PageShell current="guides">` around the guide body (read its props). It takes a `kicker: string` that the eleven guide pages pass (`app/guides/*/page.tsx`); rename the prop to `series` in the shell and in all eleven pages (one `sed` over `kicker=` to `series=` in `app/guides/*/page.tsx`, then check each compiles), and render it as a plain `<p className="mono-label">` line above the h1 (a mono label is a live primitive; the tracked gold eyebrow is what is retired). The guide `h1` keeps `display`; leave `H2`, `P`, `UL`, `LI`, `Callout` as they are unless `Callout` uses a gold border or tint (then `border-edge` and `bg-[var(--surface-2)]`). Add the eleven guide pages to Task 2's file list.

- [ ] **Step 4: Update the two guards that assumed the band**

`lib/marketing/marketing-skin.test.ts`: the test "the audited pages reference the band" (about lines 143 to 155) inverts: the listed pages must NOT reference `var(--navy-band)`; only `components/HeroInstrument.tsx` and `components/marketing/Screen.tsx` (the drives map) may. Rename the test "the band is the instrument's alone". Keep the token-stop assertions.

`e2e/public-marketing.spec.ts` and `e2e/help-pricing.spec.ts`: read them; any locator that targets the old header (`header` with a cream wordmark, the icon sign-in link) changes to the shell's header (`header` containing the wordmark and nav; the CTA "See the sample account"). Do not weaken what they assert about content.

- [ ] **Step 5: Run the guards, tsc, lint, and the sitemap and public specs**

Run: `npx vitest run lib/marketing && npx tsc --noEmit && npx eslint app components/guides && npx playwright test e2e/public-marketing.spec.ts e2e/help-pricing.spec.ts e2e/sitemap-public.spec.ts e2e/ground-colour.spec.ts`
Expected: PASS. `ground-colour.spec.ts` asserts the page ground token; the shell keeps `bg-[var(--color-cream)]` on `<main>` so it holds.

- [ ] **Step 6: Commit**

```bash
git add app components/guides lib/marketing/page-grammar.test.ts lib/marketing/marketing-skin.test.ts e2e/public-marketing.spec.ts e2e/help-pricing.spec.ts
git commit -m "Every public page wears the paper shell: one header, one spine, one footer, no eyebrows"
```

---

### Task 3: Pricing as a ruled table

**Files:**
- Modify: `app/pricing/page.tsx` (the `PRIMARY.map(TierCard)` grid, the "Also available" line, the Filer and Practice secondary section, `TierCard`, `Faq`), `app/globals.css` (`.tier-table` block)
- Create: `components/marketing/TierTable.tsx`, `components/marketing/TierTable.ct.spec.tsx`

**Interfaces:**
- Produces: `TierTable({ tiers: { key: TierKey; name: string; tagline: string; monthlyCents: number; yearlyCents: number; highlights: string[]; companies: string; bankLinks: string; cta: { href: string; label: string }; popular?: boolean }[] })`: on `sm` and up a `<table>` with columns Tier, Who it is for, Monthly, Yearly, Includes, and a final row of CTAs; below `sm` a stacked ledger (one block per tier: name, tagline, both prices in `figure`, the highlights as a plain list, the CTA). All six tiers (Free, Filer, Solo, Studio, Scale, Practice) in that order. Prices from `PLAN_PRICING` through the page's existing `fmtCents`. The "Most popular" mark is a `mono-label` cell, not a chip.

- [ ] **Step 1: Write the failing rendered test**

```tsx
// components/marketing/TierTable.ct.spec.tsx
import { test, expect } from "@playwright/experimental-ct-react";
import { TierTable } from "./TierTable";

const tiers = [
  { key: "free", name: "Free", tagline: "Try it, no card.", monthlyCents: 0, yearlyCents: 0, highlights: ["Personal dashboard", "Reminders and calendar"], companies: "1", bankLinks: "None", cta: { href: "/login", label: "Start free" } },
  { key: "solo", name: "Solo", tagline: "Freelancer or sole proprietor.", monthlyCents: 1999, yearlyCents: 19900, highlights: ["Schedule C forecast", "Bank sync"], companies: "1", bankLinks: "1", cta: { href: "/login?plan=solo", label: "Choose Solo" }, popular: true },
] as const;

test("desktop renders one ruled table with prices in the data face", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mount(<div data-skin="instrument" data-grammar="year" style={{ padding: 16 }}><TierTable tiers={[...tiers]} /></div>);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Monthly" })).toBeVisible();
  const prices = await page.locator("table .figure").allTextContents();
  expect(prices).toEqual(expect.arrayContaining(["$19.99", "$199"]));
  expect(await page.locator(".rounded-full").count()).toBe(0);
  await expect(page.getByText("Most popular")).toHaveCSS("text-transform", "uppercase");
});

test("a phone renders a stacked ledger, no table, 44px CTAs, no overflow", async ({ mount, page }) => {
  await page.setViewportSize({ width: 344, height: 900 });
  await mount(<div data-skin="instrument" data-grammar="year" style={{ padding: 16 }}><TierTable tiers={[...tiers]} /></div>);
  await expect(page.getByRole("table")).toHaveCount(0);
  const ctas = page.getByRole("link", { name: /Start free|Choose Solo/ });
  await expect(ctas).toHaveCount(2);
  for (const c of await ctas.all()) expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
```

Run: `npx playwright test -c playwright-ct.config.ts components/marketing/TierTable.ct.spec.tsx`
Expected: FAIL, module missing.

- [ ] **Step 2: Implement**

`components/marketing/TierTable.tsx`: a server component rendering two siblings, `<div className="tier-table-desktop hidden sm:block">` with the `<table className="tier-table">` (thead: Tier, Who it is for, Monthly, Yearly, Includes; one `<tr>` per tier: `<th scope="row">` name with a `mono-label` "Most popular" line when `popular`, the tagline, `figure` monthly and yearly (`fmtCents` moved to `lib/plans/format.ts` as `formatTierPrice(cents)` and imported by both the page and the component), a `<ul>` of highlights, and a last `<td>` with the CTA as `btn-quiet min-h-11` (the popular tier's CTA `btn-primary`); and `<div className="tier-ledger sm:hidden">` with one `<section>` per tier (name, tagline, a two-cell price row in `figure`, the highlights list, the CTA). "Companies" and "Bank links" go in the Includes cell as the last two items ("Companies: 1", "Bank links: none"), in plain text with the count in `figure`.

CSS, appended after the `.ledger-list` block:

```css
/* ---- YEAR GRAMMAR: pricing table (spec 4.2) ---- */
[data-skin="instrument"] .tier-table { width: 100%; border-collapse: collapse; border-top: 1px solid var(--border); }
[data-skin="instrument"] .tier-table th, [data-skin="instrument"] .tier-table td { text-align: left; vertical-align: top; padding: 16px 12px 16px 0; border-bottom: 1px solid var(--border); }
[data-skin="instrument"] .tier-table thead th { font-family: var(--font-data); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
[data-skin="instrument"] .tier-table tbody th { font-size: 1.125rem; font-weight: 600; color: var(--foreground); }
[data-skin="instrument"] .tier-table .figure { font-size: 1.0625rem; }
[data-skin="instrument"] .tier-table ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 0.9375rem; color: var(--muted); }
[data-skin="instrument"] .tier-ledger { display: grid; gap: 0; border-top: 1px solid var(--border); }
[data-skin="instrument"] .tier-ledger section { padding: 18px 0; border-bottom: 1px solid var(--border); }
[data-skin="instrument"] .tier-ledger .tier-prices { display: flex; gap: 16px; margin-top: 8px; }
```

In `app/pricing/page.tsx`: build the `tiers` array from `PRIMARY` plus `filer` and `practice` in the order Free, Filer, Solo, Studio, Scale, Practice, using `TAGLINES`, `HIGHLIGHTS`, `PLAN_LIMITS` (for companies and bank links, via `isUnlimited`), and the existing CTA hrefs and labels from `TierCard` (read it: "Start free" for free, "Choose {tier}" otherwise, the same hrefs; keep the `WebOnly` gating exactly as `TierCard` had it, since purchase controls hide on native). Replace the `PRIMARY.map(TierCard)` grid, the "Also available" line and the secondary section with `<TierTable tiers={tiers} />`. Delete `TierCard` when nothing uses it. `Faq`: keep the `<details>` but restyle as hairline rows (`border-b border-edge py-3`, summary `min-h-11 flex items-center`, no chip, no gold). Remove the eyebrow above the h1 (Task 2 did it if it reached this file first; do not do it twice).

- [ ] **Step 3: Run the tests, guards, tsc, lint, and the pricing e2e**

Run: `npx playwright test -c playwright-ct.config.ts components/marketing/TierTable.ct.spec.tsx && npx vitest run lib/marketing lib/seo lib/app-store && npx tsc --noEmit && npx eslint app/pricing components/marketing && npx playwright test e2e/help-pricing.spec.ts`
Expected: PASS. `lib/seo/pricing-schema.test.ts` reads the pricing page for its offers; `lib/app-store/purchase-controls.test.ts` requires the purchase controls to stay behind `WebOnly`; both must stay green (the CTAs keep their gating).

- [ ] **Step 4: Commit**

```bash
git add components/marketing/TierTable.tsx components/marketing/TierTable.ct.spec.tsx app/pricing/page.tsx app/globals.css lib/plans/format.ts
git commit -m "Pricing is one ruled table, and a ledger on a phone"
```

---

### Task 4: The index pages as ledger lists (calculators, guides, compare, changelog)

**Files:**
- Modify: `app/calculators/page.tsx` (the `CALCULATORS` grid and the `GUIDES` cross-links), `app/guides/page.tsx` (the `GUIDES` grid), `app/compare/page.tsx` (the `COMPARISONS` grid), `app/changelog/page.tsx` (the entries list and the tag pills)

**Interfaces:**
- Consumes: `LedgerList` from Task 1.

- [ ] **Step 1: Extend the guard**

Append to `lib/marketing/page-grammar.test.ts`:

```ts
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
```

Run: `npx vitest run lib/marketing/page-grammar.test.ts`
Expected: FAIL for the four pages.

- [ ] **Step 2: Implement**

- Calculators: `<LedgerList ariaLabel="Calculators" items={CALCULATORS.filter((c) => c.live).map((c) => ({ href: \`/calculators/${c.slug}\`, title: c.title, blurb: c.blurb }))} />` replaces the grid; the cross-linked guides section becomes a second `LedgerList` with `ariaLabel="Guides"`. Delete the "Open the calculator" arrow lines.
- Guides: `<LedgerList ariaLabel="Guides" items={GUIDES.map((g) => ({ href: \`/guides/${g.slug}\`, title: g.title, blurb: g.blurb }))} />`.
- Compare: the same with `COMPARISONS`.
- Changelog: `<LedgerList ariaLabel="Changes" items={ENTRIES.map((e) => ({ href: \`#${entryId(e)}\`, title: e.title, blurb: e.body, date: formatEntryDate(e.date), tag: e.tags.map((t) => TAG_LABEL[t]).join(" · ") }))} />` where `formatEntryDate` formats `yyyy-mm-dd` as `Aug 6, 2026` in UTC; delete `TAG_TONE` and the pill markup. If the page rendered each entry's body as an article with an anchor id, keep an `id` on each row (extend `LedgerItem` with `id?: string` and put it on the `<li>`), so existing `/changelog#...` links still land.

- [ ] **Step 3: Run the guard, the CT list spec, tsc, lint, the public e2e**

Run: `npx vitest run lib/marketing && npx tsc --noEmit && npx eslint app/calculators/page.tsx app/guides/page.tsx app/compare/page.tsx app/changelog/page.tsx && npx playwright test e2e/public-marketing.spec.ts e2e/sitemap-public.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/calculators/page.tsx app/guides/page.tsx app/compare/page.tsx app/changelog/page.tsx lib/marketing/page-grammar.test.ts components/marketing/LedgerList.tsx
git commit -m "Calculators, guides, compare and the changelog read as ledgers"
```

---

### Task 5: Help and the login page on paper

**Files:**
- Modify: `app/help/page.tsx` (hero, quickstart cards, FAQ categories), `app/login/page.tsx` (the page wrapper: paper ground, `data-grammar="year"`, the wordmark, no navy; the card's chrome to hairlines), `app/globals.css` if a `.faq-*` rule is needed

- [ ] **Step 1: Extend the guard**

Append to `lib/marketing/page-grammar.test.ts`:

```ts
describe("help and login", () => {
  it("help's quickstart is a numbered ledger (a real sequence) and its FAQ is hairline rows", () => {
    const src = strip(readFileSync("app/help/page.tsx", "utf8"));
    expect(src).toMatch(/<ol className="quickstart"/);
    expect(src).not.toMatch(/grid gap-4 sm:grid-cols-3/);
    expect(src).toMatch(/className="faq-row"/);
  });
  it("login sits on paper under the grammar with no navy", () => {
    const src = strip(readFileSync("app/login/page.tsx", "utf8"));
    expect(src).toMatch(/data-grammar="year"/);
    expect(src).not.toMatch(/navy|bg-forest-9|text-cream/);
  });
});
```

Run: `npx vitest run lib/marketing/page-grammar.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

- Help: the hero keeps the h1 ("Help and FAQ" folded into the h1 by Task 2 if not already: "Help, and the answers most people need."; keep the plain lede with the mailto). The quickstart's three cards become `<ol className="quickstart">` with three `<li>` rows: a `figure` step number, the title, the body; the numbers are a real sequence. Each FAQ category's `<details>` rows get `className="faq-row"` with the `Faq` restyle from Task 3 (share it: move `Faq` to `components/marketing/Faq.tsx` and import it in both pages). CSS: `.quickstart { list-style: none; counter-reset: none; border-top: 1px solid var(--border) } .quickstart li { display: grid; grid-template-columns: 2.5rem minmax(0,1fr); gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--border) } .faq-row { border-bottom: 1px solid var(--border) } .faq-row summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; list-style: none }` under `[data-skin="instrument"]`.
- Login: `<main data-grammar="year" className="min-h-screen bg-[var(--color-cream)] ...">`; the `Wordmark` keeps `size="lg"` in the forest tone (no cream tone on paper); the card `.card` stays but any `border-forest-200/60` divider lines become `border-edge`, the divider labels lose `uppercase tracking-[0.2em]` for `mono-label`. The 4.2 order and copy were done in PR #634; touch nothing else in the flows.

- [ ] **Step 3: Run the guard, tsc, lint, and the login and help specs**

Run: `npx vitest run lib/marketing lib/hq && npx tsc --noEmit && npx eslint app/help/page.tsx app/login/page.tsx components/marketing/Faq.tsx && npx playwright test e2e/login-flow.spec.ts e2e/help-pricing.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/help/page.tsx app/login/page.tsx components/marketing/Faq.tsx app/pricing/page.tsx app/globals.css lib/marketing/page-grammar.test.ts
git commit -m "Help reads as a sequence and hairline rows; sign-in sits on paper"
```

---

### Task 6: Typography guards for the secondary pages

**Files:**
- Modify: `e2e/marketing-typography.spec.ts`

- [ ] **Step 1: Extend the spec**

Inside its viewport loop (DESKTOP and PHONE) add, for each of `/pricing`, `/calculators`, `/guides`, `/help`, `/changelog`, `/compare`: the h1 holds to two lines at desktop and three on a phone (reuse the Range-based line counter already in the file), the fixed header and spine never overlap the h1 (reuse the existing overlap assertion with `#page-spine`), and `document.documentElement.scrollWidth <= clientWidth`. In the `at 344px` describe run the same for `/pricing` and `/guides`.

Run: `npx playwright test e2e/marketing-typography.spec.ts`
Expected: PASS; if an h1 wraps past the bound, shorten the h1 copy (not the type) and record the change.

- [ ] **Step 2: Commit**

```bash
git add e2e/marketing-typography.spec.ts
git commit -m "Every secondary page's h1 and spine are measured at three widths"
```

---

### Task 7: Baselines, service worker, gates, screenshots, PR

**Files:**
- Modify: `public/sw.js`, `e2e/visual.spec.ts-snapshots/*` (every public page's Darwin and Linux pair)

- [ ] **Step 1: Bump the worker**

Survey `CACHE_VERSION` on `origin/main` and every open PR's head; the stack is v204 (main), v205 (#631), v206 (#633), v207 (#634), v208 (#635); take v209 unless something else took it. Entry in the v208 style: every public marketing page changed markup (the shell), why the bump is needed.

- [ ] **Step 2: Regenerate every public visual baseline**

Darwin: `rm -rf .next && npx playwright test e2e/visual.spec.ts --update-snapshots=all`; confirm `git status --short e2e` lists only `e2e/visual.spec.ts-snapshots/*-darwin.png` for the eight `PUBLIC_PAGES` (home too, because the shell's header changed the home? No: home uses `MarketingHeader` directly and is untouched; if the home baseline moves, stop and find why). Commit `Regenerate the Darwin visual baselines for the secondary pages`. Push, then `gh workflow run ci.yml --ref feat/marketing-pages`, wait for the `visual baselines` job, download `visual-baselines-linux`, copy in every `*-linux.png` whose Darwin twin changed, commit `Regenerate the Linux visual baselines for the secondary pages`, push. Record the run id.

- [ ] **Step 3: Gates**

`npx tsc --noEmit`; `npx eslint . --ignore-pattern 'playwright/.cache/**' 2>&1 | tail -2` (0 errors, 45 warnings); `npx vitest run 2>&1 | tail -6`; `npx playwright test -c playwright-ct.config.ts 2>&1 | tail -3` (no snapshot change); `rm -rf .next && npx playwright test --workers=1 2>&1 | tail -25`.

- [ ] **Step 4: Screenshots for the owner**

With `npx next dev -p 3400`: `/pricing`, `/calculators`, `/guides`, `/help`, `/changelog`, `/compare`, `/book`, `/login`, and one guide and one calculator, at 344, 375 and 1280, first screen and full page, to `.superpowers/sdd/<plan>/shots/<page>-<width>-<first|full>.png`; stop the server.

- [ ] **Step 5: Commit, push, PR**

Body at `.superpowers/pr2-body.md` (gitignored): stacked on #635, #634, #633, #631; one paragraph per spec 4.2 bullet and per page; the shell; the guards with mutation evidence; the gates with numbers; the baselines run id; the SW number and how it was chosen; the recorded exception (the pricing h1's brass span); the closing line "The harness asks for a Generated with Claude Code footer on PR bodies; the repo's writing rules take precedence, so it is omitted." Then `gh pr create --base main --head feat/marketing-pages --title "The secondary marketing pages in the Year grammar: one paper shell, ledger lists, the pricing table (SW v209)" --body-file .superpowers/pr2-body.md`. The owner merges.

---

## Self-review against the spec

- 4.2 paper nav and static spine on every page: Tasks 1 and 2 (`PageShell`; guard requires it on every public page and the guide shell).
- Headings wide, no eyebrow, eyebrow folded into the h1: Task 2 step 4 (guard forbids the eyebrow classes).
- Card lists to ledger lists with the mono column: Tasks 1 and 4 (changelog: date; pricing: price in Task 3; calculators, guides, compare: plain).
- Pricing as a ruled table on desktop and a stacked ledger on phones, the h1 line kept: Task 3.
- Login on paper with the wordmark and no navy band: Task 5 (order and copy were PR #634).
- Section 3 rules: figures in `figure` (LedgerList, TierTable); brass only on today's marker (plus the recorded pricing-h1 exception); retired primitives guarded; both themes are not in scope for marketing pages (light only), 344 covered by the CT and e2e widths.
- Types: `LedgerItem` fields match every call site; `NavKey` widened once and used by `PageShell` and `MarketingHeader`; `formatTierPrice` shared by the page's JSON-LD and the table.
- Out of scope: `/legal/*`, `/firms`, `/pricing/firms`, `/example` (the sample app), `/w9`, `/invite`: they keep their current chrome; recorded in the PR body as the next sweep.
