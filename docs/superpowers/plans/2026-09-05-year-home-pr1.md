# Year interface, PR 1: foundations and the marketing home

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the marketing home page in the Year grammar from `docs/superpowers/specs/2026-09-05-year-interface-design.md` (sections 3 and 4.1), with the shared primitives later PRs reuse, and delete every retired primitive and mock component from the page.

**Architecture:** `app/page.tsx` shrinks to routing, JSON-LD and composition. The page is assembled from new server components under `components/marketing/` (header with the fixed year spine, hero, dated sequence, price strip, footer) built on two new primitives, `YearSpine` (driven by the existing `lib/marketing/tax-year-runway.ts`) and `Screen` with its row primitives. One small client component animates the spine on load and links its fill to scroll. Guards pin the grammar at source level and the geometry at render level.

**Tech Stack:** Next.js 16 app router (server components, `next/font/google`), Tailwind v4 with the Instrument skin tokens in `app/globals.css`, Vitest for source guards, Playwright for e2e and component tests, the `visual-baselines` job in `.github/workflows/ci.yml` for Linux snapshots.

## Global Constraints

- Branch off `origin/fix/marketing-audit-5-to-11` (#631, head `80f0fec`) if #631 is still open, else off `origin/main`; cherry-pick `0c39bfc` (the spec and the `.gitignore` line) onto it. Rebase onto `origin/main` before opening the PR if #631 merged meanwhile.
- No new colours. Every colour is an existing token: `--background #f2f5f8`, `--surface`, `--surface-2`, `--foreground #0c1017`, `--muted #4c5766`, `--border`, `--border-bright`, `--accent-2 #c0973f` (brass on navy), `--kicker #8a6a1c` (brass on paper), `--navy-band`.
- Brass appears on exactly two things per screen: today's marker and the live figure. Dates in the eyebrow position may be brass on paper.
- Navy (`var(--navy-band)`) is used only on the instrument panel. Page heroes and the header sit on paper.
- Type: display is Archivo, `wdth` 112, weight 600, tracking -0.025em, line-height 1.02. Every date, figure and countdown is Plex Mono via the existing `.figure` class. Body is Hanken Grotesk.
- Retired everywhere this PR touches: `.kicker`, `.kicker-sm`, eyebrow classes (`uppercase tracking-[0.2em]`, `tracking-[0.32em]`, `tracking-[0.18em]`), pill chips, `italic` taglines, `gold-shine`, the `*Mockup` components, `MockupFrame`, `next/image` on the home page.
- Copy register: plain, specific, present tense. No calmer, gentle, quietly, friendly, scary. Buttons say what happens.
- No em dashes (U+2014) anywhere: code, comments, copy, commit messages, PR body. Sweep with `grep -rP '\x{2014}'` before every commit. No emoji.
- Icons only from `components/ui/Icons`. No emoji glyphs as icons.
- Any client JS or markup change bumps `CACHE_VERSION` in `public/sw.js`, chosen against `origin/main` and every open PR at the moment of the bump; on conflict keep both changelog entries and take the next number.
- Gates before the PR: `npx tsc --noEmit` clean; `npx eslint . --ignore-pattern 'playwright/.cache/**'` adds zero warnings over main (0 errors); `npx vitest run` green; `npm run e2e` green; `npm run test:ct` green; Darwin visual baselines regenerated for home; Linux baselines from the workflow artifact committed.
- Marketing pages already sit under `[data-skin="instrument"]` (e2e/ground-colour.spec.ts proves the body carries the skin tokens). Use `.skin-scope` with `data-theme="dark"` for the navy panel exactly as `HeroInstrument` does today.
- `position: sticky` does not work here: html/body carry `overflow-x: clip` for the WebView (app/globals.css line 586). The header is `position: fixed` plus a spacer of the same height. The spine joins that fixed block.
- Sample date on the home page is fixed at `2026-09-05T00:00:00Z` (day 248, Q3 in 10 days) so baselines do not drift. Every sample surface is labelled Sample.
- Files that the existing guards read and must keep satisfying: `lib/marketing/hero-first-screen.test.ts`, `lib/marketing/marketing-skin.test.ts`, `e2e/marketing-typography.spec.ts`, `e2e/ground-colour.spec.ts`, `e2e/public-marketing.spec.ts`, `e2e/mobile-responsive.spec.ts`, `lib/app-store/purchase-controls.test.ts`, `lib/hq/invisibility.test.ts`. Edit them only where a task says so.

---

## File structure

Created:

- `components/marketing/YearSpine.tsx`: the runway, paper and panel variants. Server component.
- `components/marketing/YearSpine.ct.spec.tsx`: tick and today geometry at 344, 375, 1280.
- `components/marketing/YearSpineMotion.tsx`: client; draws the spine on load, links fill to scroll.
- `components/marketing/CountUp.tsx`: client; the live figure settles from 0 once.
- `components/marketing/Screen.tsx`: `Screen`, `StatRow`, `LedgerRow`, `CategoryBar`, `MiniMap`.
- `components/marketing/MarketingHeader.tsx`: paper nav, fixed, with an optional spine slot and the spacer.
- `components/marketing/home-copy.ts`: `HERO`, `PANEL`, `MOMENTS`, `SCREENS`, sample date constants. All copy lives here.
- `components/marketing/HomeHero.tsx`, `YearSequence.tsx`, `PriceStrip.tsx`, `MarketingFooter.tsx`.
- `lib/marketing/home-jsonld.ts`: the five JSON-LD blobs moved out of the page, unchanged.
- `lib/marketing/type-axis.test.ts`, `lib/marketing/year-grammar.test.ts`, `lib/marketing/year-spine.test.ts`, `lib/marketing/screen-primitives.test.ts`: source guards.

Modified:

- `app/layout.tsx` (Archivo `wdth` axis), `app/globals.css` (display setting, spine, screen, button and switch classes), `app/page.tsx` (rewritten), `components/HeroInstrument.tsx` (rebuilt on `YearSpine`), `components/AudienceToggle.tsx` and its `.ct.spec.tsx`, `components/MarketingNav.tsx` (paper colours), `lib/marketing/tax-year-runway.ts` and its test (`dayOfYear`, `fractionOf`), `lib/marketing/hero-first-screen.test.ts`, `lib/marketing/marketing-skin.test.ts`, `e2e/marketing-typography.spec.ts`, `public/sw.js`, the four `home-*` files in `e2e/visual.spec.ts-snapshots/`.

Deleted:

- `public/marketing/` (six photographs and `CREDITS.md`), `components/SignInIconLink.tsx` if nothing else imports it after Task 6 (check with grep; `app/page.tsx` is its only importer today).

---

### Task 0: Branch and worktree

**Files:** none changed.

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/technooptics/Projects/taxottic && git fetch origin
BASE=$(gh pr view 631 --json state --jq .state | grep -q MERGED && echo origin/main || echo origin/fix/marketing-audit-5-to-11)
git worktree add -b feat/year-home /Users/technooptics/Projects/taxottic-wt/year-home "$BASE"
cd /Users/technooptics/Projects/taxottic-wt/year-home
ln -s /Users/technooptics/Projects/taxottic/node_modules node_modules
cp /Users/technooptics/Projects/taxottic/.env.local .env.local
git cherry-pick 0c39bfc
git log --oneline -3
```

Expected: the spec commit on top of the base; `docs/superpowers/specs/2026-09-05-year-interface-design.md` present; `.gitignore` contains `.superpowers/`.

- [ ] **Step 2: Baseline the gates**

```bash
npx tsc --noEmit; echo tsc $?
npx eslint . --ignore-pattern 'playwright/.cache/**' 2>&1 | tail -1
npx vitest run 2>&1 | grep -E 'Test Files|Tests '
```

Record the eslint warning count and the test count; the PR must not raise the first or lower the second except by deletions this plan names.

---

### Task 1: Archivo width axis and the display setting

**Files:**
- Modify: `app/layout.tsx:58-63`
- Modify: `app/globals.css` (append after the `.runway-today` rule, line 314)
- Test: `lib/marketing/type-axis.test.ts`

**Interfaces:**
- Produces: `.display` under `[data-skin="instrument"]` renders Archivo at `font-stretch: 112%`, weight 600, tracking -0.025em, line-height 1.02, lining tabular numerals. New utility classes `.lede` (19px/1.45 muted, 16px on phones) and `.mono-label` (11px Plex Mono, 0.08em tracking, uppercase, muted).

- [ ] **Step 1: Write the failing guard**

```ts
// lib/marketing/type-axis.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Year grammar sets headlines in Archivo on its width axis. Google
 * serves Archivo as a variable font with wdth 62..125; next/font only
 * downloads an axis it is told about, so `font-stretch: 112%` in CSS
 * does nothing unless layout.tsx declares `axes: ["wdth"]`. This pins
 * both halves so one cannot drift without the other.
 */
const ROOT = join(__dirname, "..", "..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const layout = strip(readFileSync(join(ROOT, "app/layout.tsx"), "utf8"));
const css = strip(readFileSync(join(ROOT, "app/globals.css"), "utf8"));

describe("Archivo is loaded with its width axis", () => {
  it("layout.tsx declares axes: [\"wdth\"] on the Archivo font", () => {
    const m = /const archivo = Archivo\(\{([\s\S]*?)\}\);/.exec(layout);
    expect(m, "Archivo font block not found").toBeTruthy();
    expect(m![1]).toMatch(/axes:\s*\["wdth"\]/);
    expect(m![1], "a fixed weight list disables the variable axes").not.toMatch(/weight:\s*\[/);
  });

  it("the Instrument display rule sets the width, weight and tracking", () => {
    const m = /\[data-skin="instrument"\] \.display \{([\s\S]*?)\}/.exec(css);
    expect(m, "no [data-skin=\"instrument\"] .display rule").toBeTruthy();
    expect(m![1]).toMatch(/font-stretch:\s*112%/);
    expect(m![1]).toMatch(/font-weight:\s*600/);
    expect(m![1]).toMatch(/letter-spacing:\s*-0\.025em/);
    expect(m![1]).toMatch(/line-height:\s*1\.02/);
    expect(m![1]).toMatch(/lining-nums/);
  });

  it("defines .lede and .mono-label once", () => {
    expect((css.match(/\.lede \{/g) ?? []).length).toBe(1);
    expect((css.match(/\.mono-label \{/g) ?? []).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/marketing/type-axis.test.ts`
Expected: FAIL, "axes" not matched, no instrument display rule.

- [ ] **Step 3: Declare the axis in layout.tsx**

Replace lines 58-63 of `app/layout.tsx`:

```ts
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  // Variable font. The width axis is what sets the Year grammar's
  // headlines apart from a default grotesque; next/font downloads an
  // axis only when it is named here.
  axes: ["wdth"],
  display: "swap",
});
```

- [ ] **Step 4: Add the display setting and the two utilities to globals.css**

Insert after the `[data-skin="instrument"] .runway-today { ... }` rule (after line 314):

```css
/* ---- YEAR GRAMMAR: type -----------------------------------------
   Headlines on Archivo's width axis, semi-expanded, tight. Lining
   figures so a year or a dollar figure inside a headline sits on the
   baseline like the rest of the line. Overrides the base .display,
   which is tuned for Fraunces on the classic skin. */
[data-skin="instrument"] .display {
  font-stretch: 112%;
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.02;
  font-variant-numeric: lining-nums tabular-nums;
  font-feature-settings: "kern" 1;
}
[data-skin="instrument"] .lede {
  font-size: 1rem;
  line-height: 1.45;
  color: var(--muted);
}
@media (min-width: 640px) {
  [data-skin="instrument"] .lede { font-size: 1.1875rem; }
}
[data-skin="instrument"] .mono-label {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
```

- [ ] **Step 5: Run the guard and the type check**

Run: `npx vitest run lib/marketing/type-axis.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean. If `next/font` rejects `axes` at dev start (`npm run dev` prints a font error), the assumption in spec section 8 applies: remove `axes`, keep `weight: ["500","600","700"]`, drop `font-stretch`, set tracking to -0.03em, update the guard to match, and tell the owner in the PR body.

- [ ] **Step 6: Verify the axis renders**

Start `npm run dev -- -p 3400`, open `http://localhost:3400/` and in the browser console run
`getComputedStyle(document.querySelector("h1")).fontStretch`. Expected: `112%`. Also `document.fonts.check("600 112% 20px Archivo")` returns `true` once loaded.

- [ ] **Step 7: Commit**

```bash
git add app/layout.tsx app/globals.css lib/marketing/type-axis.test.ts
git commit -m "Load Archivo's width axis and set the Year grammar display type"
```

---

### Task 2: Runway helpers for the spine

**Files:**
- Modify: `lib/marketing/tax-year-runway.ts`
- Test: `lib/marketing/tax-year-runway.test.ts` (append)

**Interfaces:**
- Produces: `TaxYearRunway.dayOfYear: number` (1 on 1 January of the tax year, 248 on 2026-09-05; clamped to the span) and `export function fractionOf(taxYear: number, isoDate: string): number` (position of any ISO date along the rail, 0..1 clamped, same span as the ticks).

- [ ] **Step 1: Append failing tests**

```ts
// append to lib/marketing/tax-year-runway.test.ts
import { fractionOf } from "./tax-year-runway";

describe("dayOfYear and fractionOf", () => {
  it("counts days into the tax year from 1 January", () => {
    expect(taxYearRunway(2026, new Date("2026-01-01T00:00:00Z")).dayOfYear).toBe(1);
    expect(taxYearRunway(2026, new Date("2026-09-05T00:00:00Z")).dayOfYear).toBe(248);
    expect(taxYearRunway(2026, new Date("2025-06-01T00:00:00Z")).dayOfYear).toBe(0);
  });

  it("places a date on the rail with the same span as the ticks", () => {
    const { ticks } = taxYearRunway(2026, new Date("2026-09-05T00:00:00Z"));
    expect(fractionOf(2026, "2026-09-15")).toBeCloseTo(ticks[2].at, 9);
    expect(fractionOf(2026, "2027-01-15")).toBe(1);
    expect(fractionOf(2026, "2026-12-01")).toBeCloseTo(334 / 379, 6);
    expect(fractionOf(2026, "2025-01-01")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run lib/marketing/tax-year-runway.test.ts`
Expected: FAIL, `fractionOf` is not exported, `dayOfYear` undefined.

- [ ] **Step 3: Implement**

In `lib/marketing/tax-year-runway.ts` add `dayOfYear: number;` to `TaxYearRunway` after `asOfLabel`, with the doc comment `/** Days into the tax year, 1-based from 1 January; 0 before it starts. */`. In `taxYearRunway`, before the `return`:

```ts
  const dayOfYear = Math.max(0, Math.min(Math.round((now - start) / DAY_MS) + 1, Math.round(span / DAY_MS) + 1));
```

and return it. Add after the function:

```ts
/**
 * Position of an ISO date (YYYY-MM-DD) along the rail, 0..1, clamped.
 * Same span as the ticks so a section anchored to a date and the tick
 * for a due date agree to the pixel.
 */
export function fractionOf(taxYear: number, isoDate: string): number {
  const dueDates = DUE_DATES[taxYear as keyof typeof DUE_DATES];
  if (!dueDates) throw new Error(`no quarterly due dates for tax year ${taxYear}`);
  const start = Date.UTC(taxYear, 0, 1);
  const last = dueDates[dueDates.length - 1];
  const end = Date.UTC(last.inFollowingYear ? taxYear + 1 : taxYear, last.month - 1, last.day);
  const [y, m, d] = isoDate.split("-").map(Number);
  const at = Date.UTC(y, m - 1, d);
  return Math.min(1, Math.max(0, (at - start) / (end - start)));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/marketing/tax-year-runway.test.ts`
Expected: PASS (all existing cases too).

- [ ] **Step 5: Commit**

```bash
git add lib/marketing/tax-year-runway.ts lib/marketing/tax-year-runway.test.ts
git commit -m "Runway: day of year and the rail position of any date"
```

---

### Task 3: YearSpine

**Files:**
- Create: `components/marketing/YearSpine.tsx`
- Create: `components/marketing/YearSpine.ct.spec.tsx`
- Modify: `app/globals.css` (append after the Task 1 block)

**Interfaces:**
- Consumes: `taxYearRunway`, `TaxYearRunway` from Task 2.
- Produces:

```ts
export type YearSpineProps = {
  taxYear: number;
  asOf: Date;
  variant: "paper" | "panel";
  /** Text at the right of the top row. Defaults to the countdown to the next due date. */
  trailing?: string;
  /** Per-quarter note appended to a tick label, e.g. { 1: "Q1 paid" }. */
  notes?: Partial<Record<1 | 2 | 3 | 4, string>>;
  /** Prefix on the marker label; "Today" gives "TODAY · SEP 5", omit for "SEP 5". */
  markerPrefix?: string;
  id?: string;
};
export function YearSpine(props: YearSpineProps): JSX.Element;
```

The root element has `className="year-spine year-spine-<variant>"`, `data-fill` (today's fill, 4 decimals) and the CSS variable `--spine-fill` set to today's fill as a percentage. The fill element's width is `var(--spine-fill)`; the today marker's `left` is today's fill and never moves.

- [ ] **Step 1: Write the failing component test**

```tsx
// components/marketing/YearSpine.ct.spec.tsx
import { test, expect } from "@playwright/experimental-ct-react";
import { YearSpine } from "./YearSpine";
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";

/**
 * The spine is the Year grammar's signature. Its ticks must sit where the
 * runway says the due dates are, at every width we ship to, and today's
 * marker must sit at the fill. A tick one percent off reads as "Sep 15"
 * landing in October.
 */
const AS_OF = new Date("2026-09-05T00:00:00Z");
const WIDTHS = [344, 375, 1280];

for (const width of WIDTHS) {
  test.describe(`YearSpine at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("ticks and today sit at the runway's fractions", async ({ mount, page }) => {
      await mount(
        <div data-skin="instrument" style={{ padding: 16, background: "#f2f5f8" }}>
          <YearSpine taxYear={2026} asOf={AS_OF} variant="paper" id="spine" />
        </div>,
      );
      const rail = page.locator("#spine .runway-rail");
      const railBox = (await rail.boundingBox())!;
      const r = taxYearRunway(2026, AS_OF);

      const ticks = page.locator("#spine .runway-tick");
      await expect(ticks).toHaveCount(4);
      for (let i = 0; i < 4; i++) {
        const box = (await ticks.nth(i).boundingBox())!;
        const at = (box.x - railBox.x) / railBox.width;
        expect(Math.abs(at - r.ticks[i].at), `tick ${i} is off`).toBeLessThan(0.005);
      }
      const today = (await page.locator("#spine .runway-today").boundingBox())!;
      expect(Math.abs((today.x - railBox.x) / railBox.width - r.fill)).toBeLessThan(0.005);

      const fill = (await page.locator("#spine .runway-fill").boundingBox())!;
      expect(Math.abs(fill.width / railBox.width - r.fill)).toBeLessThan(0.005);

      await expect(page.locator("#spine .runway-today-label")).toHaveText(/Today · Sep 5/i);
      await expect(page.locator("#spine .year-spine-row")).toContainText(/Q3 due in 10 days/i);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "the spine must not scroll the page sideways").toBeLessThanOrEqual(0);
    });
  });
}

test("panel variant shows the trailing text and no Today prefix", async ({ mount, page }) => {
  await mount(
    <div className="skin-scope" data-skin="instrument" data-theme="dark" style={{ padding: 16, background: "#1d2843" }}>
      <YearSpine taxYear={2026} asOf={AS_OF} variant="panel" trailing="Sample" id="p" />
    </div>,
  );
  await expect(page.locator("#p .year-spine-row")).toContainText("Sample");
  await expect(page.locator("#p .runway-today-label")).toHaveText("Sep 5");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx playwright test -c playwright-ct.config.ts components/marketing/YearSpine.ct.spec.tsx`
Expected: FAIL, module `./YearSpine` not found.

- [ ] **Step 3: Write the component**

```tsx
// components/marketing/YearSpine.tsx
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";

export type YearSpineProps = {
  taxYear: number;
  asOf: Date;
  variant: "paper" | "panel";
  trailing?: string;
  notes?: Partial<Record<1 | 2 | 3 | 4, string>>;
  markerPrefix?: string;
  id?: string;
};

/**
 * The tax-year runway as the spine of a screen: a rail from 1 January to
 * the Q4 due date, ticked at the four federal due dates, filled to a
 * date, with today's marker in brass. Geometry comes from
 * lib/marketing/tax-year-runway.ts, so a tick cannot drift from the
 * statutory date.
 *
 * `--spine-fill` is a CSS variable so YearSpineMotion can move the fill
 * to a section's date as the reader scrolls; the marker stays at today.
 * Brass here is the fill, the marker and its label, nothing else.
 */
export function YearSpine({
  taxYear,
  asOf,
  variant,
  trailing,
  notes,
  markerPrefix = "Today",
  id,
}: YearSpineProps) {
  const r = taxYearRunway(taxYear, asOf);
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const last = r.ticks.length - 1;
  const countdown = r.next
    ? `Q${r.next.quarter} due in ${r.daysToNext} days`
    : "All four quarters paid";
  const marker = markerPrefix ? `${markerPrefix} · ${r.asOfLabel}` : r.asOfLabel;

  return (
    <div
      id={id}
      className={`year-spine year-spine-${variant}`}
      data-fill={r.fill.toFixed(4)}
      style={{ ["--spine-fill" as string]: pct(r.fill) }}
    >
      <div className="year-spine-row mono-label">
        <span>Tax year {taxYear}</span>
        <span>{trailing ?? countdown}</span>
      </div>
      <div className="runway" aria-hidden="true">
        <div className="runway-rail">
          <div className="runway-fill" />
          {r.ticks.map((t) => (
            <div key={t.quarter} className="runway-tick" style={{ left: pct(t.at) }} />
          ))}
          <div className="runway-today" style={{ left: pct(r.fill) }} />
          <span className="runway-today-label" style={{ left: pct(r.fill) }}>
            {marker}
          </span>
        </div>
        <div className="runway-labels">
          {r.ticks.map((t, i) => (
            <span
              key={t.quarter}
              className={i === last ? "-translate-x-full" : "-translate-x-1/2"}
              style={{ left: pct(t.at) }}
            >
              {t.label}
              {notes?.[t.quarter] ? ` · ${notes[t.quarter]}` : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the spine CSS**

Append to `app/globals.css` after the Task 1 block:

```css
/* ---- YEAR GRAMMAR: the spine ------------------------------------
   Overrides the hero-era .runway-* sizes (1px rail) with the spine's
   (2px rail, 14px ticks, 20px marker). Specificity: two classes beat
   the one-class rules above. */
[data-skin="instrument"] .year-spine { --spine-fill: 0%; position: relative; }
[data-skin="instrument"] .year-spine-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
[data-skin="instrument"] .year-spine .runway { margin-top: 1.75rem; }
[data-skin="instrument"] .year-spine .runway-rail {
  height: 2px;
  background: var(--border-bright);
  transform-origin: left center;
}
[data-skin="instrument"] .year-spine .runway-fill {
  height: 2px;
  width: var(--spine-fill);
  background: var(--accent-2);
  transition: width 0.5s ease;
}
[data-skin="instrument"] .year-spine .runway-tick {
  top: -6px;
  height: 14px;
  background: var(--foreground);
  opacity: 0.55;
}
[data-skin="instrument"] .year-spine .runway-today {
  top: -9px;
  width: 2px;
  height: 20px;
  background: var(--accent-2);
}
[data-skin="instrument"] .year-spine .runway-today-label {
  position: absolute;
  top: -30px;
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--font-data);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--kicker);
}
[data-skin="instrument"] .year-spine-panel .runway-today-label { color: var(--accent-2); }
[data-skin="instrument"] .year-spine .runway-labels {
  position: relative;
  margin-top: 0.875rem;
  height: 1rem;
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--muted);
}
[data-skin="instrument"] .year-spine .runway-labels span {
  position: absolute;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  [data-skin="instrument"] .year-spine .runway-fill { transition: none; }
}
```

- [ ] **Step 5: Run the component test**

Run: `npx playwright test -c playwright-ct.config.ts components/marketing/YearSpine.ct.spec.tsx`
Expected: PASS at 344, 375, 1280 plus the panel case. If a tick is off by the 1px tick width, the assertion tolerance (0.5%) already covers it at 344 (1px of 312px is 0.32%).

- [ ] **Step 6: Commit**

```bash
git add components/marketing/YearSpine.tsx components/marketing/YearSpine.ct.spec.tsx app/globals.css
git commit -m "YearSpine: the runway as a screen's spine, paper and panel"
```

---

### Task 4: Screen and the row primitives

**Files:**
- Create: `components/marketing/Screen.tsx`
- Modify: `app/globals.css` (append)
- Test: `lib/marketing/screen-primitives.test.ts`

**Interfaces:**
- Produces:

```ts
export function Screen(p: { title: string; status?: string; children: React.ReactNode }): JSX.Element;
export function StatRow(p: { label: string; note?: string; value: string; brass?: boolean }): JSX.Element;
export function LedgerRow(p: { date?: string; text: string; note?: string; amount: string; tag?: string; tagTone?: "quiet" | "ask" }): JSX.Element;
export function CategoryBar(p: { label: string; fraction: number; amount: string }): JSX.Element;
export function MiniMap(): JSX.Element;
```

Every `value` and `amount` renders inside an element with `className` containing `figure`. Tags are mono, 10px, bordered; `ask` is brass.

- [ ] **Step 1: Write the failing guard**

```ts
// lib/marketing/screen-primitives.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A real product screen on the marketing site renders money and dates
 * the way the app does: in the mono figure face, tabular. This pins the
 * primitives so a later edit cannot set an amount in the body face.
 */
const ROOT = join(__dirname, "..", "..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const src = strip(readFileSync(join(ROOT, "components/marketing/Screen.tsx"), "utf8"));

function body(name: string): string {
  const m = new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return m[0];
}

describe("screen primitives", () => {
  it("exports the five primitives", () => {
    for (const n of ["Screen", "StatRow", "LedgerRow", "CategoryBar", "MiniMap"]) body(n);
  });

  it("StatRow, LedgerRow and CategoryBar set their figure in .figure", () => {
    expect(body("StatRow")).toMatch(/className=\{?"[^"]*\bfigure\b[^"]*"[^>]*>\s*\{value\}/);
    expect(body("LedgerRow")).toMatch(/className="[^"]*\bfigure\b[^"]*"[^>]*>\s*\{amount\}/);
    expect(body("CategoryBar")).toMatch(/className="[^"]*\bfigure\b[^"]*"[^>]*>\s*\{amount\}/);
  });

  it("the title bar is mono, and there is no kicker, chip or italic anywhere", () => {
    expect(body("Screen")).toMatch(/className="screen-bar mono-label"/);
    expect(src).not.toMatch(/\bkicker\b|italic|tracking-\[0\.2em\]|gold-shine/);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run lib/marketing/screen-primitives.test.ts`
Expected: FAIL, file not found.

- [ ] **Step 3: Write the primitives**

```tsx
// components/marketing/Screen.tsx
import type { ReactNode } from "react";

/**
 * A real product screen, drawn with the app's own row shapes and sample
 * data. This replaces the mock "Company X · LIVE" windows: no fake
 * chrome, no status pills, the product's rows as the product sets them.
 */
export function Screen({
  title,
  status,
  children,
}: {
  title: string;
  status?: string;
  children: ReactNode;
}) {
  return (
    <div className="screen">
      <div className="screen-bar mono-label">
        <span>{title}</span>
        {status ? <span>{status}</span> : null}
      </div>
      <div className="screen-body">{children}</div>
    </div>
  );
}

export function StatRow({
  label,
  note,
  value,
  brass = false,
}: {
  label: string;
  note?: string;
  value: string;
  brass?: boolean;
}) {
  return (
    <div className="stat-row">
      <div>
        <div className="stat-label">{label}</div>
        {note ? <div className="stat-note">{note}</div> : null}
      </div>
      <div className={"figure stat-value" + (brass ? " stat-value-brass" : "")}>{value}</div>
    </div>
  );
}

export function LedgerRow({
  date,
  text,
  note,
  amount,
  tag,
  tagTone = "quiet",
}: {
  date?: string;
  text: string;
  note?: string;
  amount: string;
  tag?: string;
  tagTone?: "quiet" | "ask";
}) {
  return (
    <div className={"ledger-row" + (date ? "" : " ledger-row-undated")}>
      {date ? <span className="figure ledger-date">{date}</span> : null}
      <span className="ledger-text">
        {text}
        {note ? <span className="ledger-note">{note}</span> : null}
      </span>
      <span className="figure ledger-amount">{amount}</span>
      {tag ? <span className={"tag" + (tagTone === "ask" ? " tag-ask" : "")}>{tag}</span> : null}
    </div>
  );
}

export function CategoryBar({
  label,
  fraction,
  amount,
}: {
  label: string;
  fraction: number;
  amount: string;
}) {
  const width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  return (
    <div className="cat-row">
      <span>{label}</span>
      <span className="bar" aria-hidden="true">
        <i style={{ width }} />
      </span>
      <span className="figure cat-amount">{amount}</span>
    </div>
  );
}

/** A drive on the app's dark basemap, brass path, start and end discs. */
export function MiniMap() {
  return (
    <div className="mini-map" aria-hidden="true">
      <svg viewBox="0 0 400 150" preserveAspectRatio="none">
        <g stroke="rgba(242,245,248,0.08)">
          <path d="M0 40h400M0 80h400M0 120h400M80 0v150M160 0v150M240 0v150M320 0v150" />
        </g>
        <path
          d="M20 120 C 90 110, 120 60, 190 70 S 300 40, 380 30"
          stroke="var(--accent-2)"
          strokeWidth="2.5"
          fill="none"
        />
        <circle cx="20" cy="120" r="3.5" fill="#f2f5f8" />
        <circle cx="380" cy="30" r="3.5" fill="var(--accent-2)" />
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Add the screen CSS**

Append to `app/globals.css`:

```css
/* ---- YEAR GRAMMAR: real product screens ------------------------- */
[data-skin="instrument"] .screen {
  background: var(--surface);
  border: 1px solid var(--border-bright);
  border-radius: 8px;
  overflow: hidden;
}
[data-skin="instrument"] .screen-bar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.625rem 0.875rem;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
[data-skin="instrument"] .screen-body { padding: 1rem; }
[data-skin="instrument"] .stat-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--border);
}
[data-skin="instrument"] .stat-row:last-child { border-bottom: 0; }
[data-skin="instrument"] .stat-label { font-size: 0.875rem; color: var(--foreground); }
[data-skin="instrument"] .stat-note { font-size: 0.75rem; color: var(--muted); }
[data-skin="instrument"] .stat-value { font-size: 1.375rem; font-weight: 500; color: var(--foreground); }
[data-skin="instrument"] .stat-value-brass { color: var(--kicker); }
[data-skin="instrument"] .ledger-row {
  display: grid;
  grid-template-columns: 3.625rem minmax(0, 1fr) auto auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5625rem 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.875rem;
}
[data-skin="instrument"] .ledger-row-undated { grid-template-columns: minmax(0, 1fr) auto auto; }
[data-skin="instrument"] .ledger-row:last-child { border-bottom: 0; }
[data-skin="instrument"] .ledger-date { font-size: 0.75rem; color: var(--muted); }
[data-skin="instrument"] .ledger-text { min-width: 0; color: var(--foreground); }
[data-skin="instrument"] .ledger-note { display: block; font-size: 0.75rem; color: var(--muted); }
[data-skin="instrument"] .ledger-amount { font-size: 0.875rem; color: var(--foreground); }
[data-skin="instrument"] .tag {
  font-family: var(--font-data);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 7px;
  border: 1px solid var(--border-bright);
  border-radius: 4px;
  color: var(--muted);
  white-space: nowrap;
}
[data-skin="instrument"] .tag-ask { border-color: var(--accent-2); color: var(--kicker); }
[data-skin="instrument"] .cat-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 7.5rem 4.5rem;
  gap: 0.75rem;
  align-items: center;
  padding: 0.4375rem 0;
  font-size: 0.875rem;
}
[data-skin="instrument"] .cat-amount { text-align: right; }
[data-skin="instrument"] .bar {
  display: block;
  height: 6px;
  background: var(--surface-2);
  border-radius: 3px;
  overflow: hidden;
}
[data-skin="instrument"] .bar i { display: block; height: 100%; background: var(--accent-2); }
[data-skin="instrument"] .mini-map {
  height: 150px;
  border-radius: 6px;
  margin-bottom: 0.75rem;
  overflow: hidden;
  background: var(--navy-band);
}
[data-skin="instrument"] .mini-map svg { display: block; width: 100%; height: 100%; }
@media (max-width: 639px) {
  [data-skin="instrument"] .cat-row { grid-template-columns: minmax(0, 1fr) 4.5rem 4rem; }
}
```

- [ ] **Step 5: Run the guard and tsc**

Run: `npx vitest run lib/marketing/screen-primitives.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/marketing/Screen.tsx app/globals.css lib/marketing/screen-primitives.test.ts
git commit -m "Screen and row primitives: the product's own rows for the marketing site"
```

---

### Task 5: HeroInstrument on the spine

**Files:**
- Modify: `components/HeroInstrument.tsx` (rewrite)
- Modify: `lib/marketing/hero-first-screen.test.ts:73-85` (runway check reads YearSpine)
- Modify: `lib/marketing/marketing-skin.test.ts:129-139` (home's band lives in the instrument)

**Interfaces:**
- Consumes: `YearSpine` (Task 3), `formatCents` from `@/lib/tax/engine/money`.
- Produces:

```ts
export type PanelLedgerLine = { date: string; text: string; amount: string };
export type PanelSample = {
  heading: string;              // top-left of the panel, e.g. "Tax year 2026"; the spine repeats the year
  nextPaymentCents: number;
  setAsideCents: number;
  ledger: PanelLedgerLine[];    // three lines, what moved the number this week
  foot: string;
};
export function HeroInstrument(p: { taxYear: number; asOf: Date; sample: PanelSample }): JSX.Element;
```

Renders `<YearSpine variant="panel" trailing="Sample" markerPrefix="">`, three stat rows (next payment in brass, set aside so far, still to set aside computed as the difference and floored at 0), the ledger and the foot line. Background is `var(--navy-band)` inline on the panel.

- [ ] **Step 1: Update the guards first**

In `lib/marketing/hero-first-screen.test.ts`, replace the `describe("the runway signature is on the page", ...)` block with:

```ts
const SPINE = "components/marketing/YearSpine.tsx";

describe("the runway signature is on the page", () => {
  it("YearSpine exists and renders the runway rail, fill, ticks and today marker", () => {
    expect(existsSync(SPINE), `${SPINE} is missing`).toBe(true);
    const src = code(readFileSync(SPINE, "utf8"));
    for (const cls of ["runway-rail", "runway-fill", "runway-tick", "runway-today"]) {
      expect(new RegExp(`className="${cls}"`).test(src), `${SPINE} never renders .${cls}`).toBe(true);
    }
  });

  it("HeroInstrument mounts the panel spine on the navy band", () => {
    const src = code(readFileSync(INSTRUMENT, "utf8"));
    expect(/<YearSpine\b[^>]*variant="panel"/.test(src), "the instrument does not mount the spine").toBe(true);
    expect(/var\(--navy-band\)/.test(src), "the panel must paint the navy band token").toBe(true);
  });
});
```

In `lib/marketing/marketing-skin.test.ts`, in `it("the audited pages reference the band", ...)` replace `"app/page.tsx",` with `"components/HeroInstrument.tsx",` and change the message to `does not use --navy-band (the home page paints navy only on the instrument)`.

Run: `npx vitest run lib/marketing/hero-first-screen.test.ts lib/marketing/marketing-skin.test.ts`
Expected: FAIL on the two new instrument assertions (spine not mounted, no band token). The rest still pass.

- [ ] **Step 2: Rewrite the instrument**

```tsx
// components/HeroInstrument.tsx
import { formatCents } from "@/lib/tax/engine/money";
import { YearSpine } from "@/components/marketing/YearSpine";

export type PanelLedgerLine = { date: string; text: string; amount: string };
export type PanelSample = {
  heading: string;
  nextPaymentCents: number;
  setAsideCents: number;
  ledger: PanelLedgerLine[];
  foot: string;
};

/**
 * The instrument panel: where the reader sits in the tax year and what
 * that means in dollars. The one navy surface on a marketing page, and
 * the one place brass is spent: the spine's marker and the next payment.
 *
 * Tokens, not hex. The wrapper carries data-skin="instrument" with
 * data-theme="dark", a selector app/globals.css already defines, so every
 * token inside takes the skin's dark value. The band itself is the
 * --navy-band token so the pixel matches every other navy in the app.
 *
 * The figures and the date are a labelled sample, fixed so the visual
 * baselines stay still.
 */
export function HeroInstrument({
  taxYear,
  asOf,
  sample,
}: {
  taxYear: number;
  asOf: Date;
  sample: PanelSample;
}) {
  const still = Math.max(0, sample.nextPaymentCents - sample.setAsideCents);
  return (
    <div className="skin-scope" data-skin="instrument" data-theme="dark">
      <div
        className="rounded-[10px] p-5 sm:p-6 text-foreground shadow-[0_30px_60px_-30px_rgba(12,16,23,0.6)]"
        style={{ background: "var(--navy-band)" }}
      >
        <YearSpine taxYear={taxYear} asOf={asOf} variant="panel" trailing="Sample" markerPrefix="" />

        <dl className="mt-6">
          <div className="stat-row">
            <div>
              <dt className="stat-label">Next payment</dt>
              <dd className="stat-note">{sample.heading}</dd>
            </div>
            <dd className="figure stat-value text-[2.125rem] text-[var(--accent-2)]">
              {formatCents(sample.nextPaymentCents)}
            </dd>
          </div>
          <div className="stat-row">
            <dt className="stat-label">Set aside so far</dt>
            <dd className="figure stat-value text-[2.125rem]">{formatCents(sample.setAsideCents)}</dd>
          </div>
          <div className="stat-row">
            <dt className="stat-label">Still to set aside</dt>
            <dd className="figure stat-value text-[2.125rem]">{formatCents(still)}</dd>
          </div>
        </dl>

        <ul className="mt-3 border-t border-edge pt-2.5">
          {sample.ledger.map((l) => (
            <li key={l.date + l.text} className="flex gap-3 py-1.5 text-[13px]">
              <span className="figure w-12 shrink-0 text-muted">{l.date}</span>
              <span className="min-w-0 flex-1">{l.text}</span>
              <span className="figure">{l.amount}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-muted">{sample.foot}</p>
      </div>
    </div>
  );
}
```

The `.stat-row` rules from Task 4 are scoped to `[data-skin="instrument"]` and use `--foreground`, `--muted`, `--border`, so inside the dark scope they paint cream on navy without a second rule set. `stat-note` doubles as the "Q3 · due Sep 15 · 10 days" line via `sample.heading`, which the copy module builds from the runway in Task 7.

- [ ] **Step 3: Type-check and run the guards**

Run: `npx tsc --noEmit; npx vitest run lib/marketing/hero-first-screen.test.ts lib/marketing/marketing-skin.test.ts`
Expected: tsc fails only in `app/page.tsx` (old `HeroInstrument` props), which Task 8 rewrites; both guards pass. If tsc reports anything outside `app/page.tsx`, fix it here.

- [ ] **Step 4: Commit**

```bash
git add components/HeroInstrument.tsx lib/marketing/hero-first-screen.test.ts lib/marketing/marketing-skin.test.ts
git commit -m "HeroInstrument: the panel spine, three figures and the week's ledger on the navy band"
```

---

### Task 6: MarketingHeader, the paper nav and the audience switch

**Files:**
- Create: `components/marketing/MarketingHeader.tsx`
- Modify: `components/MarketingNav.tsx:41-77` (colours only)
- Modify: `components/AudienceToggle.tsx` (rewrite), `components/AudienceToggle.ct.spec.tsx:24-28` (mount on paper)
- Modify: `app/globals.css` (append `.btn-quiet`, `.audience-switch`)

**Interfaces:**
- Consumes: `Wordmark` (`components/Wordmark.tsx`, `tone="forest"`), `MarketingNav`.
- Produces:

```ts
export function MarketingHeader(p: {
  current?: "pricing" | "guides" | "calculators";
  cta?: { href: string; label: string };
  /** Rendered under the nav row inside the fixed block; the spacer grows to match. */
  spine?: React.ReactNode;
}): JSX.Element;
```

The header is `position: fixed`, paper ground, hairline under it, safe-area padding as the current header has; the spacer is `4rem` tall without a spine and `8.5rem` with one, plus the safe-area inset. `AudienceToggle` keeps its props, `href="/?audience=<id>"` links, `role="tab"` and `aria-selected`; it becomes a mono segmented control.

- [ ] **Step 1: Update the toggle's component test to paper**

In `components/AudienceToggle.ct.spec.tsx` change the mount wrapper to
`<div data-skin="instrument" className="p-4" style={{ background: "#f2f5f8" }}>` and add after the loop:

```ts
    const first = page.getByRole("tab", { name: "For me", exact: true });
    await expect(first).toHaveAttribute("aria-selected", "true");
    const font = await first.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font, "the switch is set in the data face").toMatch(/Plex Mono|monospace/i);
```

Run: `npx playwright test -c playwright-ct.config.ts components/AudienceToggle.ct.spec.tsx`
Expected: FAIL on the font assertion (still Hanken).

- [ ] **Step 2: Rewrite the toggle**

```tsx
// components/AudienceToggle.tsx
import Link from "next/link";

export type Audience = "personal" | "business" | "firm";

const SEGMENTS: { id: Audience; label: string }[] = [
  { id: "personal", label: "For me" },
  { id: "business", label: "For my business" },
  { id: "firm", label: "For my firm" },
];

/**
 * The audience switch. Three audiences stay because pricing and guidance
 * follow them; the control is a quiet mono segmented switch on paper
 * rather than a pill on a navy band. Links, not buttons: the page is
 * server-rendered and the audience is a query parameter, so an old link
 * into "?audience=firm" keeps working.
 *
 * At 344px the three labels in 11px mono total about 290px, so nothing
 * wraps. Pinned by AudienceToggle.ct.spec.tsx.
 */
export function AudienceToggle({ audience }: { audience: Audience }) {
  return (
    <div className="audience-switch" role="tablist" aria-label="Choose audience">
      {SEGMENTS.map((s) => {
        const active = audience === s.id;
        return (
          <Link
            key={s.id}
            href={`/?audience=${s.id}`}
            scroll={false}
            role="tab"
            aria-selected={active}
            className={"audience-seg" + (active ? " is-on" : "")}
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}
```

Append to `app/globals.css`:

```css
/* ---- YEAR GRAMMAR: controls ------------------------------------- */
[data-skin="instrument"] .audience-switch {
  display: inline-flex;
  max-width: 100%;
  border: 1px solid var(--border-bright);
  border-radius: 6px;
  overflow: hidden;
  font-family: var(--font-data);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
[data-skin="instrument"] .audience-seg {
  padding: 7px 12px;
  color: var(--muted);
  white-space: nowrap;
  transition: color 0.15s ease, background-color 0.15s ease;
}
[data-skin="instrument"] .audience-seg + .audience-seg { border-left: 1px solid var(--border-bright); }
[data-skin="instrument"] .audience-seg:hover { color: var(--foreground); }
[data-skin="instrument"] .audience-seg.is-on { color: var(--foreground); background: var(--surface); }
[data-skin="instrument"] .audience-seg:focus-visible {
  outline: 2px solid var(--accent-2);
  outline-offset: -2px;
}
[data-skin="instrument"] .btn-quiet {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.75rem;
  padding: 0 1.125rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-bright);
  color: var(--foreground);
  font-size: 0.875rem;
  font-weight: 600;
  background: transparent;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
[data-skin="instrument"] .btn-quiet:hover { border-color: var(--foreground); }
[data-skin="instrument"] .btn-quiet:focus-visible,
[data-skin="instrument"] .btn-primary:focus-visible {
  outline: 2px solid var(--accent-2);
  outline-offset: 2px;
}
@media (max-width: 359px) {
  [data-skin="instrument"] .audience-seg { padding: 7px 9px; }
}
```

- [ ] **Step 3: Recolour MarketingNav for paper**

In `components/MarketingNav.tsx` replace the class expression inside the `Link` (lines 54-61) with:

```tsx
            className={
              "group relative inline-flex items-center py-1 text-[0.9375rem] " +
              "font-medium tracking-[0.01em] transition-colors " +
              "focus-visible:outline-none focus-visible:ring-2 " +
              "focus-visible:ring-[var(--accent-2)] focus-visible:ring-offset-2 " +
              "focus-visible:ring-offset-transparent rounded-sm " +
              (active ? "text-foreground" : "text-muted hover:text-foreground")
            }
```

and replace the indicator `<span ... style={{ background: "linear-gradient(...)" }} />` with a static brass rule:

```tsx
            <span
              aria-hidden="true"
              className={
                "pointer-events-none absolute left-0 right-0 -bottom-0.5 h-px bg-[var(--accent-2)] " +
                "origin-center transition-transform duration-200 motion-reduce:transition-none " +
                (active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100")
              }
            />
```

Update the doc comment's last paragraph to say the indicator is a static brass hairline on paper. Every marketing page except home still renders `MarketingNav` on the old navy header until PR 2; on navy, `text-muted` (#4c5766) fails contrast. So add a `tone` prop and branch the two class strings:

```tsx
export function MarketingNav({
  current,
  className = "",
  tone = "navy",
}: {
  current?: NavKey;
  className?: string;
  /** "paper" for the Year grammar header; "navy" keeps the pre-PR-2 pages readable. */
  tone?: "paper" | "navy";
}) {
  const link = (active: boolean) =>
    tone === "paper"
      ? (active ? "text-foreground" : "text-muted hover:text-foreground")
      : (active ? "text-cream" : "text-cream/75 hover:text-cream");
  const ring = tone === "paper" ? "focus-visible:ring-[var(--accent-2)]" : "focus-visible:ring-gold-400/70";
  const rule = tone === "paper" ? "bg-[var(--accent-2)]" : "";
  const ruleStyle =
    tone === "paper"
      ? undefined
      : { background: "linear-gradient(90deg, transparent 0%, rgba(213,187,126,0.55) 20%, rgba(242,216,150,0.95) 50%, rgba(213,187,126,0.55) 80%, transparent 100%)" };
```

and use `link(active)`, `ring`, `rule` and `style={ruleStyle}` in the JSX in place of the literals. `MarketingHeader` passes `tone="paper"`; every other caller keeps the default.

- [ ] **Step 4: Write the header**

```tsx
// components/marketing/MarketingHeader.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import { MarketingNav } from "@/components/MarketingNav";

/**
 * The marketing header on paper. Fixed rather than sticky: html/body
 * carry overflow-x: clip for the WebView, which disables position:
 * sticky, so the block is fixed and a spacer of the same height follows
 * it (the same pattern the authenticated AppHeader uses). The optional
 * spine renders inside the fixed block so it stays in view as the reader
 * scrolls through the year.
 */
export function MarketingHeader({
  current,
  cta,
  spine,
}: {
  current?: "pricing" | "guides" | "calculators";
  cta?: { href: string; label: string };
  spine?: ReactNode;
}) {
  const safeTop = "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))";
  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-30 border-b border-edge bg-[var(--color-cream)]"
        style={{
          paddingTop: safeTop,
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Wordmark size="md" tone="forest" />
          <MarketingNav current={current} tone="paper" />
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/login" className="btn-quiet h-9 px-3.5 text-[13px]">
              Sign in
            </Link>
            {cta ? (
              <Link href={cta.href} className="btn-primary hidden sm:inline-flex h-9 px-3.5 text-[13px]">
                {cta.label}
              </Link>
            ) : null}
          </div>
        </div>
        {spine ? (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[4.5rem] pt-2">{spine}</div>
        ) : null}
      </header>
      <div
        aria-hidden="true"
        style={{ height: `calc(${safeTop} + ${spine ? "8.5rem" : "4rem"})` }}
      />
    </>
  );
}
```

- [ ] **Step 5: Run the toggle test and tsc**

Run: `npx playwright test -c playwright-ct.config.ts components/AudienceToggle.ct.spec.tsx && npx tsc --noEmit`
Expected: the toggle test passes; tsc still fails only inside `app/page.tsx` (rewritten in Task 8).

- [ ] **Step 6: Commit**

```bash
git add components/marketing/MarketingHeader.tsx components/MarketingNav.tsx components/AudienceToggle.tsx components/AudienceToggle.ct.spec.tsx app/globals.css
git commit -m "Paper header with a spine slot, mono audience switch, static brass nav rule"
```

---

### Task 7: Home copy, hero, dated sequence, price strip, footer

**Files:**
- Create: `components/marketing/home-copy.ts`
- Create: `components/marketing/HomeHero.tsx`
- Create: `components/marketing/YearSequence.tsx`
- Create: `components/marketing/PriceStrip.tsx`
- Create: `components/marketing/MarketingFooter.tsx`
- Modify: `lib/marketing/hero-first-screen.test.ts:23-45, 89-135` (guard reads the copy module)

**Interfaces:**
- Consumes: `Audience`, `AudienceToggle`, `HeroInstrument` + `PanelSample`, `YearSpine`, `Screen` primitives, `taxYearRunway`, `fractionOf`, `formatCents`, `PLAN_PRICING`, `AppStoreBadges`.
- Produces:

```ts
export const HOME_TAX_YEAR = 2026;
export const HOME_AS_OF = new Date("2026-09-05T00:00:00Z");
export type HeroCopy = { head: string; lede: string; ctaHref: string; ctaLabel: string; secondaryHref: string; secondaryLabel: string; fine: string };
export const HERO: Record<Audience, HeroCopy>;
export const PANEL: Record<Audience, PanelSample>;
export type MomentKey = "q1" | "q2" | "road" | "q3" | "dec";
export type Moment = { key: MomentKey; anchor: string; date: string; tag: string; title: string; body: string; link: string; href: string };
export const MOMENTS: Record<Audience, Moment[]>;
export function HomeHero(p: { audience: Audience }): JSX.Element;
export function YearSequence(p: { audience: Audience }): JSX.Element;
export function PriceStrip(): JSX.Element;
export function MarketingFooter(): JSX.Element;
```

Each `Moment` article carries `data-moment={key}` and `data-moment-at={fractionOf(HOME_TAX_YEAR, anchor)}`; the hero's `<p>` immediately after `<h1>` is the lede (the e2e spec selects `h1 + p`).

- [ ] **Step 1: Point the hero guard at the copy module and tighten it**

In `lib/marketing/hero-first-screen.test.ts`:

- `const PAGE = "app/page.tsx";` becomes `const COPY = "components/marketing/home-copy.ts";` and `const HERO_FILE = "components/marketing/HomeHero.tsx";`; `const page = code(readFileSync(PAGE, "utf8"));` becomes `const copy = code(readFileSync(COPY, "utf8"));`.
- `heroRecord()` matches `/const HERO: Record<Audience, HeroCopy> = \{([\s\S]*?)\n\};/` against `copy`.
- `heroComponent()` reads `HERO_FILE` and matches `/export function HomeHero\([\s\S]*?\n\}\n/`; the "Hero renders HeroInstrument" test asserts `/<HeroInstrument\b/` on it and stays.
- `SUB_BUDGET = 36`.
- `CAPABILITIES` becomes:

```ts
const CAPABILITIES: Record<string, RegExp[]> = {
  personal: [/federal and state/i, /before each payment/i, /\bmiles?\b/i, /deduction/i],
  business: [/federal and state/i, /Schedule C/i, /IRS code/i, /\bmile\b/i],
  firm: [/federal and state/i, /engagement/i, /\bmileage\b/i, /bulk export/i, /branded as your firm/i],
};
```

- `subCopy()` reads a string literal: `const sub = /lede:\s*"([^"]*)"/.exec(m[1]);` and returns `sub[1]` with whitespace collapsed.
- Add to the "brass once" describe: `it("no headline or lede uses a retired word", () => { expect(heroRecord()).not.toMatch(/\b(calmer|calm|gentle|gently|quiet|quietly|friendly|scary)\b/i); });`

Run: `npx vitest run lib/marketing/hero-first-screen.test.ts`
Expected: FAIL, copy module missing.

- [ ] **Step 2: Write the copy module**

```ts
// components/marketing/home-copy.ts
import type { Audience } from "@/components/AudienceToggle";
import type { PanelSample } from "@/components/HeroInstrument";
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";

/** Fixed sample date so the visual baselines do not drift. Day 248, Q3 in 10 days. */
export const HOME_TAX_YEAR = 2026;
export const HOME_AS_OF = new Date("2026-09-05T00:00:00Z");

export type HeroCopy = {
  head: string;
  lede: string;
  ctaHref: string;
  ctaLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  fine: string;
};

export const HERO: Record<Audience, HeroCopy> = {
  personal: {
    head: "Your taxes, as of today.",
    lede: "One number, kept current all year: what you will owe, federal and state, from the accounts you already have. You hear two weeks before each payment. Miles and deductions are logged for you.",
    ctaHref: "/example",
    ctaLabel: "See the sample account",
    secondaryHref: "/login",
    secondaryLabel: "Sign in",
    fine: "Free to look. No card.",
  },
  business: {
    head: "Your business's taxes, as of today.",
    lede: "What the business owes, federal and state, from its bank feed, kept current all year. Expenses land on their Schedule C line with the IRS code cited. Every mile is logged as it is driven.",
    ctaHref: "/example",
    ctaLabel: "See the sample account",
    secondaryHref: "/login",
    secondaryLabel: "Sign in",
    fine: "Free to look. No card.",
  },
  firm: {
    head: "Every client's year, as of today.",
    lede: "Every client's number, federal and state, kept current from their own accounts. Engagements move on their own, mileage arrives with a map and a log, bulk export sends the year-end pack. Branded as your firm.",
    ctaHref: "/book?for=firm",
    ctaLabel: "Book a walkthrough",
    secondaryHref: "/pricing#practice",
    secondaryLabel: "See pricing",
    fine: "Per seat or per client.",
  },
};

const r = taxYearRunway(HOME_TAX_YEAR, HOME_AS_OF);
const NEXT = r.next ? `Q${r.next.quarter} · due ${r.next.label} · ${r.daysToNext} days` : "All four quarters paid";

export const PANEL: Record<Audience, PanelSample> = {
  personal: {
    heading: NEXT,
    nextPaymentCents: 342_000,
    setAsideCents: 215_000,
    ledger: [
      { date: "Sep 4", text: "Drive, client site, 22.7 mi", amount: "-$16" },
      { date: "Sep 3", text: "Adobe Creative Cloud, software", amount: "-$22" },
      { date: "Sep 2", text: "Invoice paid, Northwind Co.", amount: "+$410" },
    ],
    foot: "How the number moved this week. Federal and state, in step with your bank.",
  },
  business: {
    heading: NEXT,
    nextPaymentCents: 440_000,
    setAsideCents: 300_000,
    ledger: [
      { date: "Sep 4", text: "Drive, client site, 22.7 mi", amount: "-$16" },
      { date: "Sep 3", text: "AWS, S3 and CloudFront, software", amount: "-$85" },
      { date: "Sep 2", text: "Invoice paid, Northwind Co.", amount: "+$1,240" },
    ],
    foot: "How the number moved this week. Federal and state, in step with the bank feed.",
  },
  firm: {
    heading: `Maple Lane Design Co. · ${NEXT}`,
    nextPaymentCents: 342_000,
    setAsideCents: 215_000,
    ledger: [
      { date: "Sep 4", text: "Q3 vouchers ready", amount: "14 clients" },
      { date: "Sep 3", text: "Engagement letters signed", amount: "3" },
      { date: "Sep 2", text: "Mileage logs received", amount: "9" },
    ],
    foot: "One client's panel. The console shows all of them the same way.",
  },
};

export type MomentKey = "q1" | "q2" | "road" | "q3" | "dec";
export type Moment = {
  key: MomentKey;
  /** ISO date the section is anchored to on the spine. */
  anchor: string;
  date: string;
  tag: string;
  title: string;
  body: string;
  link: string;
  href: string;
};

const SHARED: Omit<Moment, "title" | "body">[] = [
  { key: "q1", anchor: "2026-04-15", date: "Apr 15", tag: "Q1 payment · last year's return", link: "See a Schedule C export", href: "/example" },
  { key: "q2", anchor: "2026-06-15", date: "Jun 15", tag: "Q2 payment", link: "How the forecast is built", href: "/guides/quarterly-estimated-taxes-explained" },
  { key: "road", anchor: "2026-08-01", date: "Jul to Sep", tag: "On the road", link: "What a drive record holds", href: "/calculators/mileage-deduction" },
  { key: "q3", anchor: "2026-09-15", date: "Sep 15", tag: "Q3 payment", link: "How reminders are timed", href: "/help" },
  { key: "dec", anchor: "2026-12-01", date: "Dec", tag: "Before the year closes", link: "See the playbook", href: "/example" },
];

function withCopy(copy: Record<MomentKey, { title: string; body: string }>): Moment[] {
  return SHARED.map((m) => ({ ...m, ...copy[m.key] }));
}

export const MOMENTS: Record<Audience, Moment[]> = {
  personal: withCopy({
    q1: {
      title: "The return assembles itself from the year before.",
      body: "Every business transaction from last year is already on its Schedule C line, cited to the IRS publication that allows it. Export it to your preparer or your filing tool. This year's Q1 number is on the same screen.",
    },
    q2: {
      title: "The number moves when your bank does.",
      body: "New transactions land pre-sorted, with the IRC section that makes them deductible and the source one tap away. The forecast recalculates as they clear. Two weeks before June 15 it tells you the amount and where to pay it.",
    },
    road: {
      title: "Every business mile, logged while you drive.",
      body: "The phone records the drive in the background, sorts it business or personal, and prices it at the IRS rate. Each trip keeps its map and its log, the record an audit asks for. Commutes to a W-2 job are left out.",
    },
    q3: {
      title: "Two weeks out, you know the number and what is set aside.",
      body: "Set-aside is measured against the estimate, not guessed at. When the gap is closing, the reminder says so. When it is not, it says how much is still to put away and by when.",
    },
    dec: {
      title: "The moves still worth making, priced.",
      body: "A short list of legitimate ways to lower the bill, each with the dollars it saves at your bracket: retirement room, the HSA, the home office method, invoice timing. Adopt one and the forecast responds.",
    },
  }),
  business: withCopy({
    q1: {
      title: "The Schedule C assembles itself from the year before.",
      body: "Every business transaction from last year is on its Schedule C line, meals at 50%, vehicle split, each cited to the IRS publication. Export the workpaper to your CPA. This year's Q1 number is on the same screen.",
    },
    q2: {
      title: "The books move when the bank does.",
      body: "New transactions sync and land pre-sorted, IRC section cited, source one tap away. Mixed personal and business is a tap to split. Two weeks before June 15 the forecast tells you the amount and where to pay it.",
    },
    road: {
      title: "Every business mile, for every driver.",
      body: "Each phone records its drives in the background, sorts them business or personal, and prices them at the IRS rate. A team shows one driver per colour, each trip with its map and log.",
    },
    q3: {
      title: "Two weeks out, you know the number and what is set aside.",
      body: "Set-aside is measured against the estimate. When the gap is closing, the reminder says so. When it is not, it says how much is still to put away and by when.",
    },
    dec: {
      title: "The moves still worth making, priced.",
      body: "Retirement room, the HSA, the home office method, invoice timing: each with the dollars it saves at the business's bracket. Adopt one and the forecast responds.",
    },
  }),
  firm: withCopy({
    q1: {
      title: "Every client's Schedule C, assembled and cited.",
      body: "Each client's transactions are already on their Schedule C lines with the IRS publication cited. Bulk export sends every year-end pack in one pass, in your firm's name.",
    },
    q2: {
      title: "Their books move. Your console shows it.",
      body: "New transactions land pre-sorted in each client's books. Where a client needs to decide, the console says so, and the follow-up goes out on its own.",
    },
    road: {
      title: "Client mileage that arrives already defensible.",
      body: "Clients' drives are captured by GPS as they happen, sorted, and priced at the IRS rate for the period driven. You receive a contemporaneous log with a map, not a number reconstructed in April.",
    },
    q3: {
      title: "Every client's Q3, two weeks out.",
      body: "The console lists who has set aside enough, who is short, and who has not opened the app. Reminders go out under your firm's name.",
    },
    dec: {
      title: "Year-end moves, priced per client.",
      body: "Each client's playbook shows the moves still worth making at their bracket, with the dollars. Your team reviews, the client adopts, the forecast responds.",
    },
  }),
};
```

- [ ] **Step 3: Write HomeHero**

```tsx
// components/marketing/HomeHero.tsx
import Link from "next/link";
import { AudienceToggle, type Audience } from "@/components/AudienceToggle";
import { HeroInstrument } from "@/components/HeroInstrument";
import { CountUp } from "@/components/marketing/CountUp";
import { HERO, PANEL, HOME_AS_OF, HOME_TAX_YEAR } from "@/components/marketing/home-copy";
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";

/**
 * The first screen: the promise on paper at left, the instrument at
 * right. The eyebrow is the one dated fact, in brass mono. The h1 is
 * followed immediately by the lede <p>; e2e/marketing-typography.spec.ts
 * selects it as `h1 + p`.
 */
export function HomeHero({ audience }: { audience: Audience }) {
  const h = HERO[audience];
  const r = taxYearRunway(HOME_TAX_YEAR, HOME_AS_OF);
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-14 sm:pb-20">
      <AudienceToggle audience={audience} />
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-14">
        <div>
          <p className="figure text-[13px] uppercase tracking-[0.04em] text-[var(--kicker)]">
            {r.asOfLabel}, {HOME_TAX_YEAR} · {r.dayOfYear} days into the tax year
          </p>
          <h1 className="display mt-5 text-[2.5rem] sm:text-6xl lg:text-[4.125rem] text-foreground max-w-[12ch]">
            {h.head}
          </h1>
          <p className="lede mt-5 max-w-[46ch]">{h.lede}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={h.ctaHref} className="btn-primary">
              {h.ctaLabel}
            </Link>
            <Link href={h.secondaryHref} className="btn-quiet">
              {h.secondaryLabel}
            </Link>
            <span className="text-sm text-muted">{h.fine}</span>
          </div>
        </div>
        <HeroInstrument taxYear={HOME_TAX_YEAR} asOf={HOME_AS_OF} sample={PANEL[audience]} />
      </div>
      <CountUp />
    </section>
  );
}
```

`CountUp` is written in Task 9 and renders nothing on the server; create it now as a stub so this compiles:

```tsx
// components/marketing/CountUp.tsx
"use client";
/** Filled in by Task 9. */
export function CountUp() {
  return null;
}
```

- [ ] **Step 4: Write YearSequence**

```tsx
// components/marketing/YearSequence.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import type { Audience } from "@/components/AudienceToggle";
import { CategoryBar, LedgerRow, MiniMap, Screen, StatRow } from "@/components/marketing/Screen";
import { HOME_TAX_YEAR, MOMENTS, type MomentKey } from "@/components/marketing/home-copy";
import { fractionOf } from "@/lib/marketing/tax-year-runway";

/**
 * The year as Taxottic runs it: five moments, each anchored to a date on
 * the spine, paired with a real product screen. The order is the
 * calendar's, so numbering would repeat what the dates already say.
 */
const SCREENS: Record<MomentKey, ReactNode> = {
  q1: (
    <Screen title="Schedule C · 2025" status="Ready to export">
      <CategoryBar label="Line 8 · Advertising" fraction={0.22} amount="$1,240" />
      <CategoryBar label="Line 9 · Car and truck" fraction={0.64} amount="$4,118" />
      <CategoryBar label="Line 18 · Office expense" fraction={0.4} amount="$2,610" />
      <CategoryBar label="Line 27a · Other (software)" fraction={1} amount="$6,384" />
      <div className="mt-2 border-t border-edge">
        <StatRow label="Total expenses" note="31 lines, every one cited" value="$18,972" />
      </div>
    </Screen>
  ),
  q2: (
    <Screen title="This week · Chase Business" status="Synced 14 min ago">
      <LedgerRow date="Jun 03" text="AWS, S3 and CloudFront" note="Software, IRC 162" amount="$342.50" tag="Applied" />
      <LedgerRow date="Jun 02" text="Delta, BOS to SFO" note="Travel, Pub 463" amount="$612.40" tag="Applied" />
      <LedgerRow date="Jun 02" text="Sweetgreen" note="Meal with a client? 50% if so" amount="$24.50" tag="Your call" tagTone="ask" />
      <LedgerRow date="Jun 01" text="Whole Foods" note="Personal, not deductible" amount="$72.18" tag="Skipped" />
      <div className="mt-2 border-t border-edge">
        <StatRow label="Q2 estimate, after this week" note="was $4,610 on Monday" value="$4,400" brass />
      </div>
    </Screen>
  ),
  road: (
    <Screen title="Drives · August" status="312 business mi · $218">
      <MiniMap />
      <LedgerRow date="Aug 28" text="Home to client site" note="8:12 to 8:49 · business" amount="22.7 mi" tag="$15.90" />
      <LedgerRow date="Aug 27" text="Supply run" note="13:05 to 13:24 · business" amount="9.1 mi" tag="$6.37" />
      <LedgerRow date="Aug 27" text="Evening drive" note="18:40 to 19:02 · unclassified" amount="12.3 mi" tag="Your call" tagTone="ask" />
    </Screen>
  ),
  q3: (
    <Screen title="Q3 · due Sep 15" status="10 days">
      <StatRow label="Estimated payment" note="federal $2,760 · state (MA) $660" value="$3,420" brass />
      <StatRow label="Set aside so far" value="$2,150" />
      <StatRow label="Still to set aside" note="about $127 a day for ten days" value="$1,270" />
      <span className="bar mt-3" aria-hidden="true"><i style={{ width: "63%" }} /></span>
    </Screen>
  ),
  dec: (
    <Screen title="Playbook · 2026" status="Est. this year">
      <LedgerRow text="Open and fund a SEP-IRA" note="up to 20% of net" amount="$3,900" />
      <LedgerRow text="Max the HSA" note="triple tax-free" amount="$1,020" />
      <LedgerRow text="Home office, simplified method" note="300 sq ft" amount="$330" />
      <LedgerRow text="Push December invoices to January" note="defer income" amount="$610" />
      <div className="mt-2 border-t border-edge">
        <StatRow label="If you took all four" value="$5,860" />
      </div>
    </Screen>
  ),
};

export function YearSequence({ audience }: { audience: Audience }) {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 sm:pb-24" aria-labelledby="year-heading">
      <div className="flex items-baseline justify-between gap-6 border-b border-edge-bright pb-4">
        <h2 id="year-heading" className="display text-[1.75rem] sm:text-[1.875rem] text-foreground">
          A tax year, the way Taxottic runs it.
        </h2>
        <span className="mono-label hidden sm:inline">Four payments · one return · every mile</span>
      </div>
      {MOMENTS[audience].map((m) => (
        <article
          key={m.key}
          data-moment={m.key}
          data-moment-at={fractionOf(HOME_TAX_YEAR, m.anchor).toFixed(4)}
          className="grid gap-6 py-10 sm:py-11 border-b border-edge last:border-b-0 lg:grid-cols-[8.75rem_minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10"
        >
          <div>
            <div className="figure text-2xl text-foreground leading-tight">{m.date}</div>
            <div className="mono-label mt-1.5 tracking-[0.06em]">{m.tag}</div>
          </div>
          <div>
            <h3 className="display text-2xl sm:text-3xl text-foreground max-w-[16ch]">{m.title}</h3>
            <p className="mt-3 text-base text-muted max-w-[44ch]">{m.body}</p>
            <Link href={m.href} className="mt-4 inline-block border-b border-foreground text-sm font-semibold text-foreground">
              {m.link}
            </Link>
          </div>
          <div>{SCREENS[m.key]}</div>
        </article>
      ))}
    </section>
  );
}
```

- [ ] **Step 5: Write PriceStrip and MarketingFooter**

```tsx
// components/marketing/PriceStrip.tsx
import Link from "next/link";
import { PLAN_PRICING } from "@/lib/plans/limits";
import { formatCents } from "@/lib/tax/engine/money";

/** One line of pricing, from the same table /pricing renders. No new claims. */
export function PriceStrip() {
  const solo = formatCents(PLAN_PRICING.solo_monthly.amountCents);
  return (
    <section className="border-y border-edge-bright bg-[var(--surface)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
        <div>
          <p className="display text-xl sm:text-2xl text-foreground">
            Free to look around. Solo from {solo} a month.
          </p>
          <p className="mono-label mt-1.5">No card to start · Filer for W-2 only · Practice for firms</p>
        </div>
        <Link href="/pricing" className="btn-quiet shrink-0">
          See pricing
        </Link>
      </div>
    </section>
  );
}
```

`MarketingFooter.tsx`: move the `Footer` function out of `app/page.tsx` verbatim into `components/marketing/MarketingFooter.tsx` as `export function MarketingFooter()`, importing `Link` and `AppStoreBadges`, then make exactly these edits: the three column labels (`Get the app`, `Product`, `Legal`) lose `text-[10px] uppercase tracking-[0.18em] text-gold-700` and become `mono-label`; `border-forest-100` becomes `border-edge`; `text-ink-muted` becomes `text-muted`; `hover:text-forest-700` becomes `hover:text-foreground`; the chip's `bg-gold-500` dot becomes `bg-[var(--accent-2)]` and `text-forest-800` becomes `text-foreground`. The "Powered by" wrapper loses `inline-flex items-center gap-1.5 rounded-full border border-forest-100 bg-[var(--color-cream)] px-2.5 py-1` and becomes `inline-flex items-center gap-1.5` (the dot and the text stay; the pill goes, and the grammar guard in Task 8 refuses `rounded-full` chips). The "Powered by Techno Optics LLC" string stays verbatim. The disclaimer sentence stays verbatim.

- [ ] **Step 6: Run the hero guard**

Run: `npx vitest run lib/marketing/hero-first-screen.test.ts`
Expected: PASS: no gold-shine, no retired words, sub-copy under 36 words with every capability, `HomeHero` mounts `HeroInstrument`, `YearSpine` renders the four classes.

- [ ] **Step 7: Commit**

```bash
git add components/marketing/home-copy.ts components/marketing/HomeHero.tsx components/marketing/YearSequence.tsx components/marketing/PriceStrip.tsx components/marketing/MarketingFooter.tsx components/marketing/CountUp.tsx lib/marketing/hero-first-screen.test.ts
git commit -m "Home copy, hero, the dated sequence, price strip and footer in the Year grammar"
```

---

### Task 8: Rewrite app/page.tsx, delete the old sections, add the grammar guards

**Files:**
- Create: `lib/marketing/home-jsonld.ts`
- Modify: `app/page.tsx` (rewrite)
- Delete: `public/marketing/` (all seven files), `components/SignInIconLink.tsx` if unreferenced
- Test: `lib/marketing/year-grammar.test.ts`, `lib/marketing/year-spine.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3 to 7.
- Produces: `app/page.tsx` renders `MarketingHeader` (with the paper spine in its `spine` slot, `id="year-spine"`), `HomeHero`, `YearSequence`, `PriceStrip`, `MarketingFooter`, `AppDownloadBanner`, the JSON-LD and `YearSpineMotion` (stubbed until Task 9).

- [ ] **Step 1: Write the grammar guard**

```ts
// lib/marketing/year-grammar.test.ts
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

const HOME = ["app/page.tsx", "components/HeroInstrument.tsx", ...walk("components/marketing")];

const RETIRED: [RegExp, string][] = [
  // Matches the class token only; `text-[var(--kicker)]` (the brass token) is allowed.
  [/(^|[\s"'])kicker(-sm)?(?=[\s"'])/m, "eyebrow class"],
  [/tracking-\[0\.(2|32|18)em\]/, "tracked eyebrow"],
  [/\bitalic\b/, "italic tagline"],
  [/gold-shine/, "animated gold"],
  [/Mockup\b|MockupFrame/, "mock product window"],
  [/from "next\/image"/, "photograph"],
  [/rounded-full[^"]*\b(px|py)-/, "pill chip"],
  [/\b(calmer|gentle|gently|quietly)\b/i, "retired register"],
];

describe("the home page uses the Year grammar", () => {
  for (const rel of HOME) {
    it(`${rel} carries no retired primitive`, () => {
      const src = read(rel);
      for (const [re, what] of RETIRED) {
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
    expect(page.length, "app/page.tsx should be composition and routing, under 200 lines").toBeLessThan(9000);
  });

  it("no photography ships on the marketing surface", () => {
    expect(existsSync(join(ROOT, "public/marketing"))).toBe(false);
  });
});
```

```ts
// lib/marketing/year-spine.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The spine is on the page, in the fixed header, and the motion is wired to it. */
const ROOT = join(__dirname, "..", "..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const page = strip(readFileSync(join(ROOT, "app/page.tsx"), "utf8"));

describe("the year spine on the home page", () => {
  it("is passed to the header's spine slot with the fixed sample date", () => {
    expect(page).toMatch(/spine=\{\s*<YearSpine\b[^>]*variant="paper"/);
    expect(page).toMatch(/<YearSpine\b[^>]*id="year-spine"/);
    expect(page).toMatch(/asOf=\{HOME_AS_OF\}/);
  });

  it("wires the motion to that spine", () => {
    expect(page).toMatch(/<YearSpineMotion\b[^>]*spineId="year-spine"/);
  });
});
```

Run: `npx vitest run lib/marketing/year-grammar.test.ts lib/marketing/year-spine.test.ts`
Expected: FAIL on nearly every assertion (old page).

- [ ] **Step 2: Move the JSON-LD**

Create `lib/marketing/home-jsonld.ts` by cutting everything from the comment block starting `// JSON-LD structured data for the home page.` (app/page.tsx line 18) down to and including the `export`-less `const DEFINED_TERM_LD = { ... };` block that ends at line 294, pasting it unchanged, adding at the top:

```ts
import { PLAN_PRICING, type SubscriptionPriceKey } from "@/lib/plans/limits";
```

and exporting the five constants: prefix `export` on `const ORGANIZATION_LD`, `const WEBSITE_LD`, `const SOFTWARE_APP_LD`, `const NAV_LD`, `const DEFINED_TERM_LD`. `SITE_ORIGIN` and the two builder functions stay module-private.

- [ ] **Step 3: Write the stub for the motion component**

```tsx
// components/marketing/YearSpineMotion.tsx
"use client";
/** Filled in by Task 9. */
export function YearSpineMotion(_: { spineId: string; todayFill: number }) {
  return null;
}
```

- [ ] **Step 4: Rewrite app/page.tsx**

Replace the whole file with:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JsonLd } from "@/components/seo/JsonLd";
import { AppDownloadBanner } from "@/components/AppDownloadBanner";
import { type Audience } from "@/components/AudienceToggle";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { YearSpine } from "@/components/marketing/YearSpine";
import { YearSpineMotion } from "@/components/marketing/YearSpineMotion";
import { HomeHero } from "@/components/marketing/HomeHero";
import { YearSequence } from "@/components/marketing/YearSequence";
import { PriceStrip } from "@/components/marketing/PriceStrip";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { HERO, HOME_AS_OF, HOME_TAX_YEAR } from "@/components/marketing/home-copy";
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";
import {
  DEFINED_TERM_LD,
  NAV_LD,
  ORGANIZATION_LD,
  SOFTWARE_APP_LD,
  WEBSITE_LD,
} from "@/lib/marketing/home-jsonld";

/**
 * The marketing home. Routing, structured data and composition only; the
 * copy is components/marketing/home-copy.ts and every section is its own
 * component. Design: docs/superpowers/specs/2026-09-05-year-interface-design.md.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const sp = await searchParams;
  // "enterprise" is kept as an alias for "firm" so old shared links land.
  const audience: Audience =
    sp.audience === "firm" || sp.audience === "enterprise"
      ? "firm"
      : sp.audience === "business"
        ? "business"
        : "personal";
  const cta = { href: HERO[audience].ctaHref, label: HERO[audience].ctaLabel };
  const today = taxYearRunway(HOME_TAX_YEAR, HOME_AS_OF).fill;

  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <JsonLd data={ORGANIZATION_LD} />
      <JsonLd data={WEBSITE_LD} />
      <JsonLd data={SOFTWARE_APP_LD} />
      <JsonLd data={NAV_LD} />
      <JsonLd data={DEFINED_TERM_LD} />

      <AppDownloadBanner />

      <MarketingHeader
        cta={cta}
        spine={
          <YearSpine taxYear={HOME_TAX_YEAR} asOf={HOME_AS_OF} variant="paper" id="year-spine" />
        }
      />
      <YearSpineMotion spineId="year-spine" todayFill={today} />

      <HomeHero audience={audience} />
      <YearSequence audience={audience} />
      <PriceStrip />
      <MarketingFooter />
    </main>
  );
}
```

- [ ] **Step 5: Delete the photographs and the orphaned icon link**

```bash
git rm -r public/marketing
grep -rn "SignInIconLink" app components lib --include='*.tsx' --include='*.ts' | grep -v 'components/SignInIconLink.tsx' || git rm components/SignInIconLink.tsx
```

If the grep finds another importer, leave the file.

- [ ] **Step 6: Run every gate that reads source**

Run:

```bash
npx tsc --noEmit && npx vitest run && npx eslint app/page.tsx components/marketing components/HeroInstrument.tsx components/AudienceToggle.tsx components/MarketingNav.tsx lib/marketing
```

Expected: tsc clean; vitest green including the two new guards, `hero-first-screen`, `marketing-skin`, `purchase-controls`, `invisibility`; eslint 0 errors and no new warnings. `lib/visual/baseline-regeneration.test.ts` and any test that counted files under `public/marketing` will say so here; fix by following its message.

- [ ] **Step 7: Mutation-test the grammar guard**

Add `className="kicker"` to any span in `components/marketing/PriceStrip.tsx`, run `npx vitest run lib/marketing/year-grammar.test.ts`, confirm the failure names `PriceStrip.tsx: eyebrow class`, revert with `git checkout components/marketing/PriceStrip.tsx`. Then remove `<YearSpineMotion` from `app/page.tsx`, run `lib/marketing/year-spine.test.ts`, confirm "wires the motion" fails, revert.

- [ ] **Step 8: Look at it**

`npm run dev -- -p 3400`, open `/`, `/?audience=business`, `/?audience=firm` at 1280, 375 and 344 (DevTools device toolbar). Check: the header and spine stay fixed and the h1 starts below them with no overlap; the three audiences switch copy and the panel; no horizontal scroll at 344; the download banner still appears on phones and sits above the footer; the panel is the only navy on the page.

- [ ] **Step 9: Commit**

```bash
git add -A app/page.tsx lib/marketing/home-jsonld.ts components/marketing/YearSpineMotion.tsx lib/marketing/year-grammar.test.ts lib/marketing/year-spine.test.ts public/marketing components/SignInIconLink.tsx
git commit -m "Home page in the Year grammar: spine, hero, dated sequence, price strip, footer; mock sections and photographs removed"
```

---

### Task 9: Motion: the spine draws on load and follows the scroll; the figure settles

**Files:**
- Modify: `components/marketing/YearSpineMotion.tsx`, `components/marketing/CountUp.tsx`, `components/HeroInstrument.tsx` (mount CountUp on the next-payment figure), `app/globals.css` (append)
- Test: `e2e/marketing-typography.spec.ts` (append the motion tests; Task 10 adds the rest)

**Interfaces:**
- Produces: `YearSpineMotion({ spineId, todayFill })` sets `--spine-fill` on `#<spineId>` to the `data-moment-at` of the `[data-moment-at]` article crossing the viewport's vertical centre, or back to `todayFill` when none does; adds class `is-drawing` then `is-drawn` on mount (only `is-drawn`, immediately, under `prefers-reduced-motion: reduce`). `CountUp({ cents, id })` renders `formatCents(cents)` into `#<id>` while counting from 0 over 500 ms, once, with reduced motion rendering the final value immediately.

- [ ] **Step 1: Write the failing e2e tests**

Append to `e2e/marketing-typography.spec.ts`:

```ts
test.describe("the year spine moves with the reader", () => {
  test.use({ viewport: DESKTOP });

  test("fill follows the moment at the viewport centre and returns to today", async ({ page }) => {
    await ready(page, "/");
    const spine = page.locator("#year-spine");
    const today = Number(await spine.getAttribute("data-fill"));
    const fillOf = () => spine.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--spine-fill")) / 100);
    expect(Math.abs((await fillOf()) - today)).toBeLessThan(0.001);

    const dec = page.locator("[data-moment='dec']");
    const target = Number(await dec.getAttribute("data-moment-at"));
    await dec.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect.poll(fillOf, { timeout: 3000 }).toBeCloseTo(target, 2);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(fillOf, { timeout: 3000 }).toBeCloseTo(today, 2);
  });

  test("the rail draws on load and the marker stays at today", async ({ page }) => {
    await ready(page, "/");
    const spine = page.locator("#year-spine");
    await expect(spine).toHaveClass(/is-drawn/);
    const rail = (await spine.locator(".runway-rail").boundingBox())!;
    const marker = (await spine.locator(".runway-today").boundingBox())!;
    const today = Number(await spine.getAttribute("data-fill"));
    expect(Math.abs((marker.x - rail.x) / rail.width - today)).toBeLessThan(0.005);
  });

  test("reduced motion renders the final state at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page, "/");
    const spine = page.locator("#year-spine");
    await expect(spine).toHaveClass(/is-drawn/);
    await expect(spine).not.toHaveClass(/is-drawing/);
    const figure = page.locator("#hero-next-payment");
    await expect(figure).toHaveText(/\$3,420|\$4,400/);
  });
});
```

Run: `npx playwright test --project=chromium e2e/marketing-typography.spec.ts -g "year spine"`
Expected: FAIL (no class, fill does not move, `#hero-next-payment` missing).

- [ ] **Step 2: Write the motion component**

```tsx
// components/marketing/YearSpineMotion.tsx
"use client";
import { useEffect } from "react";

/**
 * Two behaviours for the home page's spine, and nothing else animates.
 *
 * On load the rail draws left to right and the marker and its label land
 * (CSS transitions keyed on .is-drawing then .is-drawn). As the reader
 * scrolls, the fill moves to the date of the moment crossing the
 * viewport's centre and returns to today above the sequence; the marker
 * never moves, so the distance between a moment and today is visible.
 * Under prefers-reduced-motion the final state renders immediately and
 * the fill still follows the scroll without transition (see globals.css).
 */
export function YearSpineMotion({ spineId, todayFill }: { spineId: string; todayFill: number }) {
  useEffect(() => {
    const spine = document.getElementById(spineId);
    if (!spine) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      spine.classList.add("is-drawn");
    } else {
      spine.classList.add("is-drawing");
      let raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => spine.classList.add("is-drawn"));
      });
      void raf;
    }

    const moments = Array.from(document.querySelectorAll<HTMLElement>("[data-moment-at]"));
    const setFill = (f: number) => spine.style.setProperty("--spine-fill", `${(f * 100).toFixed(2)}%`);
    const update = () => {
      const mid = window.innerHeight / 2;
      const active = moments.find((m) => {
        const r = m.getBoundingClientRect();
        return r.top <= mid && r.bottom > mid;
      });
      setFill(active ? Number(active.dataset.momentAt) : todayFill);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [spineId, todayFill]);
  return null;
}
```

- [ ] **Step 3: Write CountUp and mount it**

```tsx
// components/marketing/CountUp.tsx
"use client";
import { useEffect } from "react";

/**
 * The live figure settles from 0 to its value once, over 500 ms, in the
 * tabular mono face so the width never changes. The server renders the
 * final value, so a reader with reduced motion or no JS sees it at once.
 */
export function CountUp({ id, cents }: { id: string; cents: number }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 500);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt.format(Math.round((cents / 100) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id, cents]);
  return null;
}
```

In `components/HeroInstrument.tsx` give the next-payment `<dd>` `id="hero-next-payment"` and render `<CountUp id="hero-next-payment" cents={sample.nextPaymentCents} />` after the `</dl>`. Remove the `<CountUp />` stub call from `HomeHero.tsx`. Confirm `formatCents(342_000)` renders `$3,420` with no cents (check `lib/tax/engine/money.ts` `showCents` default); if it renders `$3,420.00`, pass `{ showCents: false }` in the instrument and keep `maximumFractionDigits: 0` in CountUp so the final frame matches the server text.

Append to `app/globals.css`:

```css
/* ---- YEAR GRAMMAR: the one motion moment ------------------------ */
[data-skin="instrument"] .year-spine.is-drawing .runway-rail { transform: scaleX(0); }
[data-skin="instrument"] .year-spine.is-drawing .runway-today,
[data-skin="instrument"] .year-spine.is-drawing .runway-today-label { opacity: 0; }
[data-skin="instrument"] .year-spine.is-drawn .runway-rail {
  transform: scaleX(1);
  transition: transform 0.4s ease;
}
[data-skin="instrument"] .year-spine.is-drawn .runway-today,
[data-skin="instrument"] .year-spine.is-drawn .runway-today-label {
  opacity: 1;
  transition: opacity 0.15s ease 0.4s;
}
@media (prefers-reduced-motion: reduce) {
  [data-skin="instrument"] .year-spine .runway-rail,
  [data-skin="instrument"] .year-spine .runway-today,
  [data-skin="instrument"] .year-spine .runway-today-label { transition: none; }
}
```

The `.runway-tick` elements sit inside `.runway-rail`, so they scale with it during the draw; that is the intended effect (the ticks arrive with the rail).

- [ ] **Step 4: Run the e2e motion tests and the guards**

Run: `npx playwright test --project=chromium e2e/marketing-typography.spec.ts -g "year spine" && npx vitest run lib/marketing && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/marketing/YearSpineMotion.tsx components/marketing/CountUp.tsx components/marketing/HomeHero.tsx components/HeroInstrument.tsx app/globals.css e2e/marketing-typography.spec.ts
git commit -m "The spine draws on load, follows the scroll, and the next payment settles once"
```

---

### Task 10: Rendered guards, baselines, worker bump, PR

**Files:**
- Modify: `e2e/marketing-typography.spec.ts` (h1 lines, header geometry)
- Modify: `public/sw.js` (`CACHE_VERSION`, changelog entry)
- Modify: `e2e/visual.spec.ts-snapshots/home-visual-{desktop,mobile}-{darwin,linux}.png`

- [ ] **Step 1: Add the rendered typography tests**

Inside the existing `for (const vp of [DESKTOP, PHONE])` describe in `e2e/marketing-typography.spec.ts`, replace the "hero sub-copy" test's expectation with `expect(lines).toBeLessThanOrEqual(vp.width >= 1024 ? 4 : 6);` and add a comment: "36 words at 19px in a 46ch column is four lines by design; the copy names the number and two capabilities." Then add:

```ts
    test("the home h1 holds to two lines at desktop and three on a phone", async ({ page }) => {
      await ready(page, "/");
      const lines = await page.evaluate(() => {
        const h = document.querySelector("h1")!;
        const range = document.createRange();
        range.selectNodeContents(h);
        const tops = new Set<number>();
        for (const r of Array.from(range.getClientRects())) if (r.width > 0) tops.add(Math.round(r.top));
        return tops.size;
      });
      expect(lines).toBeLessThanOrEqual(vp.width >= 1024 ? 2 : 3);
    });

    test("the fixed header and spine never overlap the hero", async ({ page }) => {
      await ready(page, "/");
      const header = (await page.locator("header").first().boundingBox())!;
      const h1 = (await page.locator("h1").boundingBox())!;
      expect(h1.y, "the h1 starts under the fixed block").toBeGreaterThan(header.y + header.height);
      const spine = (await page.locator("#year-spine").boundingBox())!;
      expect(spine.y + spine.height, "the spine sits inside the header block").toBeLessThanOrEqual(header.y + header.height + 1);
    });
```

Add a `test.describe("at 344px", ...)` with `viewport: { width: 344, height: 882 }` running the same two tests plus the existing `docOverflow <= 0` check on `/`.

Run: `npm run e2e -- e2e/marketing-typography.spec.ts`
Expected: PASS on both projects. If the h1 wraps to three lines at 1280, the `max-w-[12ch]` in `HomeHero` is the knob; do not shrink the type.

- [ ] **Step 2: Run the whole e2e and component suites**

Run: `npm run e2e && npm run test:ct`
Expected: green. `e2e/ground-colour.spec.ts` must still read `rgb(242, 245, 248)` on home; `public-marketing.spec.ts` still finds JSON-LD; `mobile-responsive.spec.ts` still finds no overflow.

- [ ] **Step 3: Regenerate the Darwin baselines for home only**

```bash
npm run e2e:visual:update -- -g "visual: home"
git status --short e2e/visual.spec.ts-snapshots
```

Expected: exactly `home-visual-desktop-darwin.png` and `home-visual-mobile-darwin.png` modified. Then `npm run e2e:visual -- -g "visual: home"` passes.

- [ ] **Step 4: Bump the service worker**

Check the number first: `git show origin/main:public/sw.js | grep 'CACHE_VERSION ='` and `gh pr list --state open --json number,headRefName --jq '.[].headRefName'` followed by `git show origin/<branch>:public/sw.js | grep 'CACHE_VERSION ='` for each. Take the next unused number (v206 if #631 is v205 and nothing else bumped). In `public/sw.js`, above the constant, add:

```js
// v206: the marketing home in the Year grammar.
//
// The tax-year runway is the page's spine, fixed under a paper header,
// filled to the moment the reader is looking at; the hero moves to paper
// with navy reserved for the instrument panel; the dated sequence with
// real product screens replaces the capability cards, the photograph
// cards, the mock product tour, the stats band and the manifesto. Two
// new client components (the spine motion and the figure count-up) and
// new markup on every visitor's first screen, so the worker must fetch
// the new HTML rather than hydrate cached chunks against it. Chosen
// against origin/main and every open PR at the moment of the bump.
const CACHE_VERSION = "v206";
```

- [ ] **Step 5: Full gates and the em-dash sweep**

```bash
npx tsc --noEmit && npx eslint . --ignore-pattern 'playwright/.cache/**' 2>&1 | tail -1 && npx vitest run 2>&1 | grep -E 'Test Files|Tests '
git diff origin/main...HEAD | grep '^+' | grep -cP '\x{2014}'
```

Expected: tsc clean, eslint warnings at or below the Task 0 count, vitest green, em-dash count 0.

- [ ] **Step 6: Commit and push, then the Linux baselines**

```bash
git add -A && git commit -m "Rendered guards for the home h1 and the fixed spine; Darwin baselines; SW v206"
git push -u origin feat/year-home
gh workflow run ci.yml --ref feat/year-home
```

Wait for the run (`gh run list --workflow=ci.yml --branch feat/year-home --limit 1`), then:

```bash
RUN=$(gh run list --workflow=ci.yml --branch feat/year-home --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
gh run download "$RUN" -n visual-baselines-linux -D /tmp/baselines
cp /tmp/baselines/e2e/visual.spec.ts-snapshots/home-visual-desktop-linux.png /tmp/baselines/e2e/visual.spec.ts-snapshots/home-visual-mobile-linux.png e2e/visual.spec.ts-snapshots/
git status --short e2e/visual.spec.ts-snapshots
```

Expected: only the two `home-*-linux.png` files changed. Commit: `git commit -am "Regenerate the Linux visual baselines for home" && git push`.

- [ ] **Step 7: Before and after screenshots for the owner**

With `npm run dev -- -p 3400` on the branch and the main checkout's server on 3021, capture `/`, `/?audience=business`, `/?audience=firm` at 1280, 375 and 344 (viewport and full page) and send the pairs with `SendUserFile`, as was done for #631.

- [ ] **Step 8: Open the PR**

```bash
gh pr create --title "The marketing home in the Year grammar (SW v206)" --body-file .superpowers/pr1-body.md
```

Body (written to `.superpowers/pr1-body.md`, which is gitignored): what changed and why (one paragraph per spec section 4.1 item), the guards added and how each was mutation-tested, the gates with numbers, the baselines' run id, the assumption about Archivo's width axis and how it resolved, and the line "The harness asks for a Generated with Claude Code footer on PR bodies; the repo's writing rules take precedence, so it is omitted." No emoji, no em dashes. The owner merges.

---

## Self-review against the spec

- 3 Palette rules: brass only on the marker and the live figure (Tasks 3, 5); navy only on the panel (Tasks 5, 8; guard in `marketing-skin.test.ts` now reads the instrument). Covered.
- 3 Type: width axis, weights, tracking (Task 1); mono for every date and figure (`.figure`, `.mono-label`, guard in Task 4). Covered.
- 3 Signature: paper and panel variants, fixed on home, scroll-linked fill, marker fixed, sample date (Tasks 3, 8, 9). Covered.
- 3 Real product screens: `Screen` and rows, no Company X chrome (Task 4, guard). Covered.
- 3 Copy register: home-copy.ts, guard for retired words (Tasks 7, 8). Covered.
- 3 Motion: one moment, reduced motion (Task 9, e2e). Covered.
- 3 Quality floor: 344 up (CT and e2e at 344), focus rings (Task 6 CSS), no overflow (e2e), no emoji, stroke icons (none needed on home). Covered.
- 4.1 items 1 to 7: header (Task 6), spine (3), hero (7), audience switch (6), sequence (7), price strip (7), footer (7), removals (8), download banner kept (8). Covered.
- 6 Delivery: gates, baselines, SW bump, screenshots, owner merges (Task 10). Covered.
- 7 Guards named for PR 1: `year-grammar.test.ts`, `year-spine.test.ts`, typography extensions. Covered. `lib/native/first-screen.test.ts` belongs to PR 4.
- Type consistency: `YearSpineProps` fields match every call site (`variant`, `trailing`, `markerPrefix`, `id`); `PanelSample` matches `home-copy.ts`; `Moment.anchor` feeds `fractionOf(taxYear, iso)`; `YearSpineMotion({ spineId, todayFill })` matches `app/page.tsx` and the guard regex; `CountUp({ id, cents })` matches the instrument.
