# Today and the phone tab bar (PR 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard becomes Today: the year spine with real dates, the next payment as the first figure, the items that need the user's call resolving in place, the week's ledger and the year to date; and the phone gets a tab bar.

**Architecture:** Presentation only: every figure comes from data the dashboard already loads (the personal and combined forecasts, the reminders, the outstanding tally) plus three small reads (this week's expenses, trips and applied transactions; the year's expenses by category). The Today screen is a set of server components under `components/today/`, composed by `app/dashboard/page.tsx` in place of the greeting header and the hero stat band, with the pure arithmetic in `lib/today/` and unit-tested. The row primitives the marketing screens already use (`StatRow`, `LedgerRow`, `CategoryBar` in `components/marketing/Screen.tsx`) are re-exported for the app so the two render identically, as spec section 3 promises. The tab bar is a client component mounted in the app header, shown on native shells below `lg`, with its routes computed by a pure function from the memberships and the stored workspace mode.

**Tech Stack:** Next.js 16 (App Router, server components, server actions), React 19, Tailwind v4 (instrument skin on `<body>`, dark theme via `html[data-theme="dark"]`), Supabase (server client), vitest, Playwright component tests (`playwright-ct.config.ts`).

Spec: `docs/superpowers/specs/2026-09-05-year-interface-design.md` sections 3, 4.3 and 4.4. Audits (Desktop, 2026-09-14): iOS I7 (greeting, eyebrow, first money figure below the fold), I12 and Android I12 (no tab bar), Android I7.

## Global Constraints

- No em dashes (U+2014) anywhere: code, comments, copy, commit messages, PR text. No emoji. Icons only from `components/ui/Icons` or inline stroke `<Path>` as `LeftRail` does.
- Copy register: plain, specific, present tense. Never "calmer, gentle, gently, quietly, friendly, scary". No italics. Labels label; buttons say what happens ("Not business", "Open").
- Every date and money figure sits in an element with the `figure` class (Plex Mono, tabular). Brass (`--accent-2`, or `--kicker` on paper) only on today's marker and the live figure (the next payment); everything else ink, muted, surface.
- Retired primitives may not appear in the Today components: `kicker`, `kicker-sm`, pill chips (`rounded-full` with padding around text), italic taglines, `gold-shine`, gold utilities (`text-gold-*`, `bg-gold-*`, `border-gold-*`).
- Both app themes: every new component is checked in light and dark (CT specs assert 4.5:1 on text). The app defaults light; dark is `html[data-theme="dark"]`.
- Tap targets: 44px minimum on phones for every control this plan adds.
- Web behaviour unchanged where the plan does not touch it; the tab bar renders only on native shells and below `lg`; nothing needs a store build.
- The dashboard's data reads stay bounded: at most three new queries, each scoped to the user (and company where the table is per company) and the tax year or the last seven days.
- Any client JS or markup change bumps `CACHE_VERSION` in `public/sw.js` (Task 8), chosen against `origin/main` and every open PR at the moment of the bump, keeping every changelog entry.
- Gates before every commit: `npx tsc --noEmit` clean; `npx eslint . --ignore-pattern 'playwright/.cache/**'` 0 errors and 46 warnings; `npx vitest run` green; the component suite green with no existing snapshot changed.
- Commit messages end with the exact trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and nothing after it.
- Branch `feat/today-screen`, worktree `/Users/technooptics/Projects/taxottic-wt/today-screen`, stacked on `feat/native-front-door` (PR #634). Never use bare `git stash`.

---

### Task 1: The arithmetic of Today (pure modules)

**Files:**
- Create: `lib/today/next-payment.ts`, `lib/today/next-payment.test.ts`, `lib/today/spine-notes.ts`, `lib/today/spine-notes.test.ts`, `lib/today/week.ts`, `lib/today/week.test.ts`, `lib/today/categories.ts`, `lib/today/categories.test.ts`

**Interfaces:**
- Produces:
  - `nextPaymentSummary(input: { quarters: { quarter: 1|2|3|4; dueDate: string; amountCents: number; isPast: boolean }[]; paidSoFarCents: number; asOf: Date }): { next: { quarter: number; dueDate: string; daysUntil: number; amountCents: number } | null; paidSoFarCents: number; stillToPayCents: number; progress: number }`
  - `spineNotes(input: { quarters: { quarter: 1|2|3|4; dueDate: string; isPast: boolean }[]; doneDueDates: string[] }): string[]` (one note per Q1..Q4 tick in due-date order: `"Q1 · done"`, `"Q2 · past"`, `"Q3 · due"`, `"Q4"`)
  - `weekLedger(input: { expenses: { createdAt: string; amountCents: number; label: string }[]; trips: { endedAt: string; miles: number; deductionCents: number; classification: string | null }[]; applied: { appliedAt: string; amountCents: number; label: string }[]; asOf: Date; maxRows?: number }): { date: string; text: string; amount: string; sortKey: number }[]`
  - `categoryTotals(rows: { categoryCode: string | null; amountCents: number }[], labelFor: (code: string) => string, max?: number): { code: string; label: string; amountCents: number; fraction: number }[]`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/today/next-payment.test.ts
import { describe, expect, it } from "vitest";
import { nextPaymentSummary } from "./next-payment";

const Q = (quarter: 1 | 2 | 3 | 4, dueDate: string, amountCents: number, isPast: boolean) => ({ quarter, dueDate, amountCents, isPast });

describe("next payment", () => {
  const asOf = new Date("2026-09-05T00:00:00Z");
  it("picks the first future quarter with money owed and counts the days", () => {
    const s = nextPaymentSummary({
      quarters: [Q(1, "2026-04-15", 300000, true), Q(2, "2026-06-15", 300000, true), Q(3, "2026-09-15", 342000, false), Q(4, "2027-01-15", 342000, false)],
      paidSoFarCents: 600000,
      asOf,
    });
    expect(s.next).toEqual({ quarter: 3, dueDate: "2026-09-15", daysUntil: 10, amountCents: 342000 });
    expect(s.stillToPayCents).toBe(684000);
    expect(s.paidSoFarCents).toBe(600000);
    expect(s.progress).toBeCloseTo(600000 / (600000 + 684000), 6);
  });
  it("skips future quarters that need no payment and reports null when nothing is owed", () => {
    const s = nextPaymentSummary({ quarters: [Q(3, "2026-09-15", 0, false), Q(4, "2027-01-15", -500, false)], paidSoFarCents: 0, asOf });
    expect(s.next).toBeNull();
    expect(s.stillToPayCents).toBe(0);
    expect(s.progress).toBe(0);
  });
  it("never reports negative days: a due date today is 0", () => {
    const s = nextPaymentSummary({ quarters: [Q(3, "2026-09-05", 1000, false)], paidSoFarCents: 0, asOf });
    expect(s.next?.daysUntil).toBe(0);
  });
});
```

```ts
// lib/today/spine-notes.test.ts
import { describe, expect, it } from "vitest";
import { spineNotes } from "./spine-notes";

describe("spine notes", () => {
  it("names each quarter tick by what happened", () => {
    expect(
      spineNotes({
        quarters: [
          { quarter: 1, dueDate: "2026-04-15", isPast: true },
          { quarter: 2, dueDate: "2026-06-15", isPast: true },
          { quarter: 3, dueDate: "2026-09-15", isPast: false },
          { quarter: 4, dueDate: "2027-01-15", isPast: false },
        ],
        doneDueDates: ["2026-04-15"],
      }),
    ).toEqual(["Q1 · done", "Q2 · past", "Q3 · due", "Q4"]);
  });
  it("orders by due date whatever order the quarters arrive in", () => {
    const notes = spineNotes({
      quarters: [
        { quarter: 4, dueDate: "2027-01-15", isPast: false },
        { quarter: 1, dueDate: "2026-04-15", isPast: true },
      ],
      doneDueDates: [],
    });
    expect(notes).toEqual(["Q1 · past", "Q4 · due"]);
  });
});
```

```ts
// lib/today/week.test.ts
import { describe, expect, it } from "vitest";
import { weekLedger } from "./week";

describe("this week's ledger", () => {
  const asOf = new Date("2026-09-05T12:00:00Z");
  it("merges expenses, business drives and applied transactions from the last seven days, newest first, signed", () => {
    const rows = weekLedger({
      expenses: [{ createdAt: "2026-09-03T10:00:00Z", amountCents: 2200, label: "Adobe Creative Cloud" }],
      trips: [
        { endedAt: "2026-09-04T18:00:00Z", miles: 22.7, deductionCents: 1646, classification: "business" },
        { endedAt: "2026-09-04T19:00:00Z", miles: 5, deductionCents: 362, classification: "personal" },
      ],
      applied: [{ appliedAt: "2026-09-02T09:00:00Z", amountCents: 41000, label: "Invoice paid, Northwind Co." }],
      asOf,
    });
    expect(rows.map((r) => r.text)).toEqual(["Drive, 22.7 mi", "Adobe Creative Cloud", "Invoice paid, Northwind Co."]);
    expect(rows.map((r) => r.amount)).toEqual(["-$16", "-$22", "+$410"]);
    expect(rows.map((r) => r.date)).toEqual(["Sep 4", "Sep 3", "Sep 2"]);
  });
  it("drops anything older than seven days and caps the rows", () => {
    const rows = weekLedger({
      expenses: Array.from({ length: 10 }, (_, i) => ({ createdAt: `2026-09-0${(i % 5) + 1}T10:00:00Z`, amountCents: 100 * (i + 1), label: `e${i}` })).concat([{ createdAt: "2026-08-20T10:00:00Z", amountCents: 999, label: "old" }]),
      trips: [],
      applied: [],
      asOf,
      maxRows: 7,
    });
    expect(rows).toHaveLength(7);
    expect(rows.some((r) => r.text === "old")).toBe(false);
  });
});
```

```ts
// lib/today/categories.test.ts
import { describe, expect, it } from "vitest";
import { categoryTotals } from "./categories";

describe("year to date by category", () => {
  it("sums by code, labels, orders by amount and scales fractions to the largest", () => {
    const out = categoryTotals(
      [
        { categoryCode: "advertising", amountCents: 100000 },
        { categoryCode: "software", amountCents: 250000 },
        { categoryCode: "advertising", amountCents: 24000 },
        { categoryCode: null, amountCents: 5000 },
      ],
      (c) => ({ advertising: "Advertising", software: "Software" })[c] ?? c,
    );
    expect(out.map((o) => [o.label, o.amountCents, o.fraction])).toEqual([
      ["Software", 250000, 1],
      ["Advertising", 124000, 0.496],
      ["Uncategorised", 5000, 0.02],
    ]);
  });
  it("caps the list", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ categoryCode: `c${i}`, amountCents: 1000 * (8 - i) }));
    expect(categoryTotals(rows, (c) => c, 5)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/today`
Expected: FAIL, four missing modules.

- [ ] **Step 3: Implement**

```ts
// lib/today/next-payment.ts
/**
 * The first figure on Today. Spec 4.3 item 3.
 *
 * The quarters come from the forecast's quarterly estimates, whose
 * amountCents already nets W-2 withholding and the estimated payments the
 * user recorded on their tax profile; "paid so far" is that recorded
 * total. The app records no separate set-aside ledger, so "still to pay"
 * is the sum of the quarters still ahead that owe money.
 */
export type Quarter = { quarter: 1 | 2 | 3 | 4; dueDate: string; amountCents: number; isPast: boolean };

const DAY_MS = 86_400_000;

export function nextPaymentSummary(input: { quarters: Quarter[]; paidSoFarCents: number; asOf: Date }) {
  const ahead = [...input.quarters].filter((q) => !q.isPast).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const owed = ahead.filter((q) => q.amountCents > 0);
  const first = owed[0] ?? null;
  const stillToPayCents = owed.reduce((a, q) => a + q.amountCents, 0);
  const paidSoFarCents = Math.max(0, input.paidSoFarCents);
  const total = paidSoFarCents + stillToPayCents;
  const next = first
    ? {
        quarter: first.quarter,
        dueDate: first.dueDate,
        daysUntil: Math.max(0, Math.round((Date.parse(`${first.dueDate}T00:00:00Z`) - Date.UTC(input.asOf.getUTCFullYear(), input.asOf.getUTCMonth(), input.asOf.getUTCDate())) / DAY_MS)),
        amountCents: first.amountCents,
      }
    : null;
  return { next, paidSoFarCents, stillToPayCents, progress: total > 0 ? paidSoFarCents / total : 0 };
}
```

```ts
// lib/today/spine-notes.ts
/** One note per quarter tick on Today's spine, in due-date order. */
export function spineNotes(input: {
  quarters: { quarter: 1 | 2 | 3 | 4; dueDate: string; isPast: boolean }[];
  doneDueDates: string[];
}): string[] {
  const sorted = [...input.quarters].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const done = new Set(input.doneDueDates);
  let dueMarked = false;
  return sorted.map((q) => {
    if (done.has(q.dueDate)) return `Q${q.quarter} · done`;
    if (q.isPast) return `Q${q.quarter} · past`;
    if (!dueMarked) {
      dueMarked = true;
      return `Q${q.quarter} · due`;
    }
    return `Q${q.quarter}`;
  });
}
```

```ts
// lib/today/week.ts
import { formatCents } from "@/lib/tax/engine/money";

const DAY_MS = 86_400_000;

function monthDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

/** Signed, whole-dollar figure: expenses and drives negative, income positive. */
function signed(cents: number, sign: "-" | "+"): string {
  const whole = formatCents(Math.round(Math.abs(cents) / 100) * 100);
  return `${sign}${whole}`;
}

/** The last seven days of what moved the number, newest first. Spec 4.3 item 5. */
export function weekLedger(input: {
  expenses: { createdAt: string; amountCents: number; label: string }[];
  trips: { endedAt: string; miles: number; deductionCents: number; classification: string | null }[];
  applied: { appliedAt: string; amountCents: number; label: string }[];
  asOf: Date;
  maxRows?: number;
}) {
  const floor = input.asOf.getTime() - 7 * DAY_MS;
  const rows: { date: string; text: string; amount: string; sortKey: number }[] = [];
  for (const e of input.expenses) {
    const t = Date.parse(e.createdAt);
    if (t >= floor) rows.push({ date: monthDay(e.createdAt), text: e.label, amount: signed(e.amountCents, "-"), sortKey: t });
  }
  for (const d of input.trips) {
    const t = Date.parse(d.endedAt);
    if (t >= floor && d.classification === "business")
      rows.push({ date: monthDay(d.endedAt), text: `Drive, ${d.miles.toFixed(1)} mi`, amount: signed(d.deductionCents, "-"), sortKey: t });
  }
  for (const a of input.applied) {
    const t = Date.parse(a.appliedAt);
    if (t >= floor) rows.push({ date: monthDay(a.appliedAt), text: a.label, amount: signed(a.amountCents, a.amountCents >= 0 ? "+" : "-"), sortKey: t });
  }
  rows.sort((a, b) => b.sortKey - a.sortKey);
  return rows.slice(0, input.maxRows ?? 7);
}
```

```ts
// lib/today/categories.ts
/** Year to date by category, largest first, fractions scaled to the largest. Spec 4.3 item 6. */
export function categoryTotals(
  rows: { categoryCode: string | null; amountCents: number }[],
  labelFor: (code: string) => string,
  max = 6,
) {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const code = r.categoryCode ?? "uncategorised";
    sums.set(code, (sums.get(code) ?? 0) + r.amountCents);
  }
  const ordered = [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
  const top = ordered[0]?.[1] ?? 0;
  return ordered.map(([code, amountCents]) => ({
    code,
    label: code === "uncategorised" ? "Uncategorised" : labelFor(code),
    amountCents,
    fraction: top > 0 ? Math.round((amountCents / top) * 1000) / 1000 : 0,
  }));
}
```

`formatCents` lives in `lib/tax/engine/money.ts` and drops cents by default; the week ledger rounds to whole dollars first so "-$16" reads as the spec's sample. If `formatCents(1600)` renders "$16" the test passes; if it renders "$16.00", pass `{ showCents: false }`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/today && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/today
git commit -m "The arithmetic of Today: next payment, spine notes, the week's ledger, the year by category"
```

---

### Task 2: Row primitives shared with the app, and spine tick notes

**Files:**
- Create: `components/ui/Rows.ts` (re-exports), `lib/today/rows.test.ts`
- Modify: `components/marketing/YearSpine.tsx` (optional `tickNotes?: string[]` rendered under each tick's date in `.mono-label`), `components/marketing/YearSpine.ct.spec.tsx` (one case)

**Interfaces:**
- Produces: `export { Screen, StatRow, LedgerRow, CategoryBar, MiniMap } from "@/components/marketing/Screen";` at `components/ui/Rows.ts`; `YearSpine` accepts `tickNotes?: string[]` (aligned with the runway's ticks in order).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/today/rows.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("the app renders the same rows the marketing screens do", () => {
  it("re-exports the primitives from one place", () => {
    const src = readFileSync("components/ui/Rows.ts", "utf8");
    expect(src).toMatch(/export \{ Screen, StatRow, LedgerRow, CategoryBar, MiniMap \} from "@\/components\/marketing\/Screen";/);
  });
});
```

Append to `components/marketing/YearSpine.ct.spec.tsx` inside its describe:

```tsx
  test("tick notes render under the dates in the mono label style", async ({ mount, page }) => {
    await mount(
      <div data-skin="instrument" style={{ width: 600 }}>
        <YearSpine taxYear={2026} asOf={new Date("2026-09-05T00:00:00Z")} variant="paper" tickNotes={["Q1 · done", "Q2 · past", "Q3 · due", "Q4"]} />
      </div>,
    );
    const notes = page.locator(".runway-tick-note");
    await expect(notes).toHaveCount(4);
    await expect(notes.nth(2)).toHaveText("Q3 · due");
    expect(await notes.nth(2).evaluate((e) => getComputedStyle(e).textTransform)).toBe("uppercase");
  });
```

Run: `npx vitest run lib/today/rows.test.ts` and `npx playwright test -c playwright-ct.config.ts components/marketing/YearSpine.ct.spec.tsx`
Expected: FAIL (no Rows.ts; no `.runway-tick-note`).

- [ ] **Step 2: Implement**

`components/ui/Rows.ts`:

```ts
/**
 * The product's own rows, one source for the app and the marketing
 * screens (spec section 3: "styled exactly as the app renders them").
 */
export { Screen, StatRow, LedgerRow, CategoryBar, MiniMap } from "@/components/marketing/Screen";
```

In `components/marketing/YearSpine.tsx`, add `tickNotes?: string[]` to the props type (JSDoc: "One note per tick, in tick order, rendered under the date; Today uses it for Q1 · done and so on") and, inside the tick label element for tick `i`, render `{tickNotes?.[i] ? <span className="runway-tick-note mono-label block">{tickNotes[i]}</span> : null}` after the date text. In `app/globals.css`, under the `.year-spine` block, add `[data-skin="instrument"] .year-spine .runway-tick-note { margin-top: 2px; font-size: 10px; }`.

- [ ] **Step 3: Run the tests and the spine suite**

Run: `npx vitest run lib/today && npx playwright test -c playwright-ct.config.ts components/marketing/YearSpine.ct.spec.tsx && npx tsc --noEmit`
Expected: PASS; the existing spine cases unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/ui/Rows.ts lib/today/rows.test.ts components/marketing/YearSpine.tsx components/marketing/YearSpine.ct.spec.tsx app/globals.css
git commit -m "The app shares the marketing rows, and the spine can note each tick"
```

---

### Task 3: TodayHeader, TodaySpine and NextPaymentPanel

**Files:**
- Create: `components/today/TodayHeader.tsx`, `components/today/TodaySpine.tsx`, `components/today/NextPaymentPanel.tsx`, `components/today/NextPaymentPanel.ct.spec.tsx`
- Modify: `app/globals.css` (a `.today-*` block)

**Interfaces:**
- Produces:
  - `TodayHeader({ asOf: Date; taxYear: number; syncedAt?: Date | null })`: an `h1.display` "Today" and a mono meta row `SEP 5, 2026 · TAX YEAR 2026 · SYNCED 4 MIN AGO` (the last part only when `syncedAt` is given).
  - `TodaySpine({ taxYear: number; asOf: Date; tickNotes: string[] })`: wraps `<YearSpine variant="paper" id="today-spine" tickNotes />`.
  - `NextPaymentPanel({ summary: ReturnType<typeof nextPaymentSummary>; federalCents: number; stateCents: number; forecastHref: string })`.

- [ ] **Step 1: Write the failing rendered test**

```tsx
// components/today/NextPaymentPanel.ct.spec.tsx
import { test, expect } from "@playwright/experimental-ct-react";
import { NextPaymentPanel } from "./NextPaymentPanel";

const summary = {
  next: { quarter: 3, dueDate: "2026-09-15", daysUntil: 10, amountCents: 342000 },
  paidSoFarCents: 215000,
  stillToPayCents: 342000,
  progress: 215000 / 557000,
};

for (const theme of ["light", "dark"] as const) {
  test(`the next payment leads in brass, the rest in ink, readable in ${theme}`, async ({ mount, page }) => {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await mount(
      <div data-skin="instrument" data-grammar="year" style={{ width: 360, padding: 16 }}>
        <NextPaymentPanel summary={summary} federalCents={276000} stateCents={66000} forecastHref="/personal/forecast" />
      </div>,
    );
    const figure = page.locator("#today-next-payment");
    await expect(figure).toHaveText("$3,420");
    const color = await figure.evaluate((e) => getComputedStyle(e).color);
    expect(color).toBe(theme === "dark" ? "rgb(212, 174, 92)" : "rgb(138, 106, 28)");
    await expect(page.getByText("Q3 · due Sep 15 · 10 days")).toBeVisible();
    await expect(page.getByText("Paid so far")).toBeVisible();
    await expect(page.getByText("Still to pay")).toBeVisible();
    const bar = page.locator(".today-progress i");
    expect(await bar.evaluate((e) => parseFloat(getComputedStyle(e).width) / parseFloat(getComputedStyle(e.parentElement!).width))).toBeCloseTo(215000 / 557000, 1);
    // every figure is mono
    const fonts = await page.locator(".figure").evaluateAll((els) => els.map((e) => getComputedStyle(e).fontVariantNumeric));
    for (const f of fonts) expect(f).toContain("tabular-nums");
  });
}
```

Run: `npx playwright test -c playwright-ct.config.ts components/today/NextPaymentPanel.ct.spec.tsx`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement**

```tsx
// components/today/TodayHeader.tsx
/** Spec 4.3 item 1. No greeting: the page's name is the date. */
export function TodayHeader({ asOf, taxYear, syncedAt }: { asOf: Date; taxYear: number; syncedAt?: Date | null }) {
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(asOf);
  const synced = syncedAt ? relative(asOf.getTime() - syncedAt.getTime()) : null;
  return (
    <header className="today-header">
      <h1 className="display today-title">Today</h1>
      <p className="mono-label today-meta">
        <span className="figure">{date}</span>
        <span aria-hidden="true"> · </span>
        <span>Tax year <span className="figure">{taxYear}</span></span>
        {synced ? (
          <>
            <span aria-hidden="true"> · </span>
            <span>Synced <span className="figure">{synced}</span></span>
          </>
        ) : null}
      </p>
    </header>
  );
}

function relative(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
```

```tsx
// components/today/TodaySpine.tsx
import { YearSpine } from "@/components/marketing/YearSpine";

/** Spec 4.3 item 2: the real year, the real today, each tick named. */
export function TodaySpine({ taxYear, asOf, tickNotes }: { taxYear: number; asOf: Date; tickNotes: string[] }) {
  return (
    <div className="today-spine">
      <YearSpine taxYear={taxYear} asOf={asOf} variant="paper" id="today-spine" tickNotes={tickNotes} />
    </div>
  );
}
```

```tsx
// components/today/NextPaymentPanel.tsx
import Link from "next/link";
import { formatCents } from "@/lib/tax/engine/money";
import { StatRow } from "@/components/ui/Rows";
import type { nextPaymentSummary } from "@/lib/today/next-payment";

type Summary = ReturnType<typeof nextPaymentSummary>;

/** Spec 4.3 item 3: the live figure first, in brass, then what is paid and what remains. */
export function NextPaymentPanel({ summary, federalCents, stateCents, forecastHref }: { summary: Summary; federalCents: number; stateCents: number; forecastHref: string }) {
  const n = summary.next;
  const heading = n
    ? `Q${n.quarter} · due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${n.dueDate}T00:00:00Z`))} · ${n.daysUntil} day${n.daysUntil === 1 ? "" : "s"}`
    : "No payment due";
  return (
    <section className="today-panel" aria-labelledby="today-next-payment-label">
      <div className="today-lead">
        <div>
          <div id="today-next-payment-label" className="today-lead-label">Next payment</div>
          <div className="mono-label today-lead-note">{heading}</div>
        </div>
        <div id="today-next-payment" className="figure today-lead-figure">{n ? formatCents(n.amountCents) : formatCents(0)}</div>
      </div>
      <p className="today-split">
        Federal <span className="figure">{formatCents(federalCents)}</span> and state <span className="figure">{formatCents(stateCents)}</span> for the year.
      </p>
      <dl className="today-rows">
        <StatRow label="Paid so far" value={formatCents(summary.paidSoFarCents)} />
        <StatRow label="Still to pay" value={formatCents(summary.stillToPayCents)} />
      </dl>
      <div className="today-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summary.progress * 100)} aria-label="Paid so far against the year">
        <i style={{ width: `${Math.round(summary.progress * 1000) / 10}%` }} />
      </div>
      <Link href={forecastHref} className="btn-quiet today-link">Open the forecast</Link>
    </section>
  );
}
```

`StatRow` renders `div`s, so wrap in a `div`, not a `dl`, if the primitive's markup is not `dt`/`dd` (read `components/marketing/Screen.tsx`); the class list on the value must keep `figure`.

Append to `app/globals.css` after the `.audience-switch` block:

```css
/* ---- YEAR GRAMMAR: Today (spec 4.3) ---- */
[data-skin="instrument"] .today-header { display: flex; flex-direction: column; gap: 6px; }
[data-skin="instrument"] .today-title { font-size: 2.25rem; line-height: 1.02; }
@media (min-width: 640px) { [data-skin="instrument"] .today-title { font-size: 2.75rem; } }
[data-skin="instrument"] .today-meta { color: var(--muted); }
[data-skin="instrument"] .today-spine { margin-top: 20px; }
[data-skin="instrument"] .today-panel { margin-top: 24px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
[data-skin="instrument"] .today-lead { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
[data-skin="instrument"] .today-lead-label { font-size: 0.9375rem; color: var(--foreground); }
[data-skin="instrument"] .today-lead-note { margin-top: 4px; color: var(--muted); }
[data-skin="instrument"] .today-lead-figure { font-size: 2.75rem; line-height: 1; font-weight: 500; color: var(--kicker); }
@media (min-width: 640px) { [data-skin="instrument"] .today-lead-figure { font-size: 3.25rem; } }
[data-skin="instrument"] .today-split { margin-top: 12px; font-size: 0.875rem; color: var(--muted); }
[data-skin="instrument"] .today-rows { margin-top: 14px; }
[data-skin="instrument"] .today-progress { margin-top: 14px; height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
[data-skin="instrument"] .today-progress i { display: block; height: 100%; background: var(--accent-2); }
[data-skin="instrument"] .today-link { margin-top: 16px; }
[data-skin="instrument"] .today-section { margin-top: 28px; }
[data-skin="instrument"] .today-section-title { font-size: 1.125rem; font-weight: 600; color: var(--foreground); }
[data-skin="instrument"] .today-empty { margin-top: 10px; font-size: 0.875rem; color: var(--muted); }
```

Note on brass: on paper the live figure uses `--kicker` (`#8a6a1c` light) per spec section 3 ("`--kicker` on paper"); in the dark theme `--kicker` resolves to `#d4ae5c`, which is what the test asserts.

- [ ] **Step 3: Run the test in both themes, tsc, and the grammar guards**

Run: `npx playwright test -c playwright-ct.config.ts components/today/NextPaymentPanel.ct.spec.tsx && npx tsc --noEmit && npx vitest run lib/marketing`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/today/TodayHeader.tsx components/today/TodaySpine.tsx components/today/NextPaymentPanel.tsx components/today/NextPaymentPanel.ct.spec.tsx app/globals.css
git commit -m "Today's header, spine and the next payment panel"
```

---

### Task 4: Needs your call, This week, Year to date

**Files:**
- Create: `components/today/NeedsYourCall.tsx`, `components/today/NeedsYourCallRow.tsx` (client), `components/today/NeedsYourCall.ct.spec.tsx`, `components/today/ThisWeek.tsx`, `components/today/YearToDate.tsx`, `components/today/today-actions.ts`
- Modify: none

**Interfaces:**
- Consumes: `OutstandingItem` from `lib/tasks/outstanding.ts` (`kind: "trip" | "csv_transaction" | "bank_transaction"; id; title; subtitle; href`), `dismissSyncedTransaction(formData)` from `app/c/[publicId]/banks/actions.ts` (fields `publicId`, `txId`), `LedgerRow` and `CategoryBar` from `components/ui/Rows`.
- Produces:
  - `NeedsYourCall({ items: (OutstandingItem & { publicId?: string })[]; count: number })`: heading "Needs your call" with the count in a `figure`; one `NeedsYourCallRow` per item; empty state "Nothing waiting on you."
  - `NeedsYourCallRow({ item })` (client): title, subtitle, and two controls: for `bank_transaction` with a `publicId`, a form posting `dismissSyncedTransaction` labelled "Not business" (44px) and a link to `item.href` labelled "Business"; for other kinds a single link "Open" to `item.href`. The form uses `useFormStatus` for a pending state; on success the row is gone after the action's `revalidatePath` (the row hides itself optimistically with `useOptimistic` or a local `done` state).
  - `ThisWeek({ rows: { date; text; amount }[] })`: "This week" section of `LedgerRow`s; empty state "Nothing moved the number this week."
  - `YearToDate({ rows: { label; amountCents; fraction }[]; href })`: "Year to date" section of `CategoryBar`s with a quiet link "All deductions".

- [ ] **Step 1: Write the failing rendered test**

```tsx
// components/today/NeedsYourCall.ct.spec.tsx
import { test, expect } from "@playwright/experimental-ct-react";
import { NeedsYourCall } from "./NeedsYourCall";

const items = [
  { kind: "bank_transaction" as const, id: "t1", title: "Sweetgreen", subtitle: "Sep 2 · $24.50 · Meal with a client?", href: "/c/abc/banks?tx=t1", publicId: "abc" },
  { kind: "csv_transaction" as const, id: "r1", title: "Delta 4821", subtitle: "Sep 1 · $612.40", href: "/c/abc/import/i1?highlight=r1" },
];

test("rows resolve in place where they can and open where they cannot, on 44px controls", async ({ mount, page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await mount(
    <div data-skin="instrument" data-grammar="year" style={{ padding: 16 }}>
      <NeedsYourCall items={items} count={2} />
    </div>,
  );
  await expect(page.getByRole("heading", { name: /Needs your call/ })).toBeVisible();
  const notBusiness = page.getByRole("button", { name: "Not business" });
  await expect(notBusiness).toHaveCount(1);
  const box = await notBusiness.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("link", { name: "Business" })).toHaveAttribute("href", "/c/abc/banks?tx=t1");
  await expect(page.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/c/abc/import/i1?highlight=r1");
  const dates = await page.locator(".figure").allTextContents();
  expect(dates.some((t) => /Sep 2/.test(t))).toBe(true);
});
```

Run: `npx playwright test -c playwright-ct.config.ts components/today/NeedsYourCall.ct.spec.tsx`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement**

```ts
// components/today/today-actions.ts
"use server";

import { dismissSyncedTransaction } from "@/app/c/[publicId]/banks/actions";

/** The one in-place resolution Today offers: a synced transaction is not business. */
export async function notBusiness(formData: FormData): Promise<void> {
  await dismissSyncedTransaction(formData);
}
```

```tsx
// components/today/NeedsYourCallRow.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { notBusiness } from "./today-actions";
import type { OutstandingItem } from "@/lib/tasks/outstanding";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-quiet min-h-11" disabled={pending}>
      {pending ? "Saving" : "Not business"}
    </button>
  );
}

export function NeedsYourCallRow({ item }: { item: OutstandingItem & { publicId?: string } }) {
  const [done, setDone] = useState(false);
  if (done) return null;
  const [date, ...rest] = item.subtitle.split(" · ");
  const canDismiss = item.kind === "bank_transaction" && item.publicId;
  return (
    <li className="today-call-row">
      <div className="min-w-0">
        <div className="today-call-title">{item.title}</div>
        <div className="today-call-sub">
          <span className="figure">{date}</span>
          {rest.length ? <span> · {rest.join(" · ")}</span> : null}
        </div>
      </div>
      <div className="today-call-actions">
        {canDismiss ? (
          <>
            <Link href={item.href} className="btn-primary min-h-11">Business</Link>
            <form action={async (fd) => { await notBusiness(fd); setDone(true); }}>
              <input type="hidden" name="publicId" value={item.publicId} />
              <input type="hidden" name="txId" value={item.id} />
              <Submit />
            </form>
          </>
        ) : (
          <Link href={item.href} className="btn-quiet min-h-11">Open</Link>
        )}
      </div>
    </li>
  );
}
```

```tsx
// components/today/NeedsYourCall.tsx
import { NeedsYourCallRow } from "./NeedsYourCallRow";
import type { OutstandingItem } from "@/lib/tasks/outstanding";

/** Spec 4.3 item 4. */
export function NeedsYourCall({ items, count }: { items: (OutstandingItem & { publicId?: string })[]; count: number }) {
  return (
    <section className="today-section" aria-labelledby="today-call">
      <h2 id="today-call" className="today-section-title">
        Needs your call <span className="figure today-count">{count}</span>
      </h2>
      {items.length === 0 ? (
        <p className="today-empty">Nothing waiting on you.</p>
      ) : (
        <ul className="today-call-list">
          {items.map((it) => (
            <NeedsYourCallRow key={`${it.kind}:${it.id}`} item={it} />
          ))}
        </ul>
      )}
    </section>
  );
}
```

```tsx
// components/today/ThisWeek.tsx
import { LedgerRow } from "@/components/ui/Rows";

/** Spec 4.3 item 5. */
export function ThisWeek({ rows }: { rows: { date: string; text: string; amount: string }[] }) {
  return (
    <section className="today-section" aria-labelledby="today-week">
      <h2 id="today-week" className="today-section-title">This week</h2>
      {rows.length === 0 ? (
        <p className="today-empty">Nothing moved the number this week.</p>
      ) : (
        <div className="today-ledger">
          {rows.map((r, i) => (
            <LedgerRow key={`${r.date}-${r.text}-${i}`} date={r.date} title={r.text} amount={r.amount} />
          ))}
        </div>
      )}
    </section>
  );
}
```

```tsx
// components/today/YearToDate.tsx
import Link from "next/link";
import { CategoryBar } from "@/components/ui/Rows";
import { formatCents } from "@/lib/tax/engine/money";

/** Spec 4.3 item 6. */
export function YearToDate({ rows, href }: { rows: { label: string; amountCents: number; fraction: number }[]; href: string }) {
  return (
    <section className="today-section" aria-labelledby="today-ytd">
      <h2 id="today-ytd" className="today-section-title">Year to date</h2>
      {rows.length === 0 ? (
        <p className="today-empty">No deductions logged yet this year.</p>
      ) : (
        <div className="today-bars">
          {rows.map((r) => (
            <CategoryBar key={r.label} label={r.label} amount={formatCents(r.amountCents)} fraction={r.fraction} />
          ))}
        </div>
      )}
      <Link href={href} className="btn-quiet today-link min-h-11">All deductions</Link>
    </section>
  );
}
```

Read `components/marketing/Screen.tsx` for the exact prop names of `LedgerRow` (`date`, `title`, `amount`, optional `note`, `tag`, `tagTone`) and `CategoryBar` (`label`, `amount`, `fraction`) and match them. Append to the `.today-*` CSS block: `.today-call-list { margin-top: 10px; display: grid; gap: 8px; }`, `.today-call-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }`, `.today-call-title { font-size: 0.9375rem; color: var(--foreground); }`, `.today-call-sub { margin-top: 2px; font-size: 0.8125rem; color: var(--muted); }`, `.today-call-actions { display: flex; gap: 8px; flex-shrink: 0; }`, `.today-count { margin-left: 6px; color: var(--muted); font-size: 0.875rem; }`, `.today-ledger, .today-bars { margin-top: 10px; }`, all under `[data-skin="instrument"]`.

- [ ] **Step 3: Run the test in both themes, tsc, lint**

Run: `npx playwright test -c playwright-ct.config.ts components/today && npx tsc --noEmit && npx eslint components/today`
Expected: PASS. Add a dark-theme case to `NeedsYourCall.ct.spec.tsx` asserting the title's contrast against the row ground is at least 4.5:1 (copy the contrast helper from `components/mileage/LocationBlockedStrip.ct.spec.tsx`).

- [ ] **Step 4: Commit**

```bash
git add components/today app/globals.css
git commit -m "Needs your call resolves in place; this week and the year to date read as rows"
```

---

### Task 5: The dashboard becomes Today

**Files:**
- Modify: `app/dashboard/page.tsx` (the company branch, the `<header>` at about line 939 through the hero stat band ending about line 1070; and the personal-only branch's header and stat band at about lines 1583 to 1700), `lib/today/today-grammar.test.ts` (create)

**Interfaces:**
- Consumes: everything from Tasks 1 to 4; the page's existing `personalForecast`, `combinedBusiness`, `taxYear`, `outstanding`, `upcomingReminders`, `overdueReminders`, `companies`, `personalTaxProfile`, `personalExpenseRows`, `admin`, `user`.

- [ ] **Step 1: Write the failing guard**

```ts
// lib/today/today-grammar.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the dashboard is Today", () => {
  const page = strip(readFileSync("app/dashboard/page.tsx", "utf8"));
  it("composes Today in the spec's order and never greets", () => {
    const order = ["<TodayHeader", "<TodaySpine", "<NextPaymentPanel", "<NeedsYourCall", "<ThisWeek", "<YearToDate"].map((t) => page.indexOf(t));
    expect(order.every((i) => i >= 0), "every Today section is rendered").toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(page).not.toMatch(/buildGreeting|greeting\.head|greeting\.pleasantry/);
    expect(page).not.toMatch(/<OutstandingTasksBanner|<OutstandingTasksPopup/);
    expect(page).toMatch(/data-grammar="year"/);
  });
  it("keeps the retired primitives out of the Today components", () => {
    for (const f of readdirSync("components/today").filter((f) => f.endsWith(".tsx") && !f.includes(".ct."))) {
      const src = strip(readFileSync(`components/today/${f}`, "utf8"));
      expect(src, f).not.toMatch(/kicker|gold-shine|text-gold-|bg-gold-|border-gold-|italic|rounded-full/);
      expect(src, f).not.toMatch(/\b(calmer|gentle|gently|quietly|friendly|scary)\b/i);
    }
  });
});
```

Run: `npx vitest run lib/today/today-grammar.test.ts`
Expected: FAIL (no Today components in the page; greeting present).

- [ ] **Step 2: Rewire the company branch**

In `app/dashboard/page.tsx`, in the company branch's returned JSX (the `<section className="max-w-5xl ...">` at about line 938):

1. Add `data-grammar="year"` to that `<section>`.
2. Replace the `<header>` (kicker, greeting h1, pleasantry) with `<TodayHeader asOf={now} taxYear={taxYear} />` where `const now = new Date();` is declared once near the top of the function (reuse if one exists).
3. Remove the `OutstandingTasksBanner` block and `<OutstandingTasksPopup ... />` from this branch (keep the imports only if the personal-only branch still uses them; otherwise remove the imports).
4. Keep `<MarkReachedToday />`, the `LocationBlockedStrip` block and `<TrialBanner trial={trial} />` where they are, directly under the header.
5. Replace the hero stat band `<section className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">...</section>` with:

```tsx
        <TodaySpine taxYear={taxYear} asOf={now} tickNotes={tickNotes} />
        <NextPaymentPanel summary={payment} federalCents={activeForecast?.federalIncomeTaxCents ?? 0} stateCents={activeForecast?.stateTaxCents ?? 0} forecastHref={forecastHref} />
        <NeedsYourCall items={callItems} count={outstanding.count} />
        <ThisWeek rows={weekRows} />
        <YearToDate rows={ytdRows} href={deductionsHref} />
```

and compute, before the `return`:

```tsx
  const activeForecast = combinedBusiness?.result ?? personalForecast;
  const quarters = (activeForecast?.quarterlyEstimates ?? []).map((q) => ({ quarter: q.quarter, dueDate: q.dueDate, amountCents: q.amountCents, isPast: q.isPast }));
  const payment = nextPaymentSummary({ quarters, paidSoFarCents: Number(personalTaxProfile?.estimated_payments_cents ?? 0), asOf: now });
  const doneDueDates = (completedReminders ?? []).map((r) => String(r.due_at).slice(0, 10));
  const tickNotes = spineNotes({ quarters, doneDueDates });
  const forecastHref = primaryManaged ? `/c/${primaryManaged.public_id}/forecast` : "/personal/forecast";
  const deductionsHref = primaryManaged ? `/c/${primaryManaged.public_id}/expenses` : "/personal/expenses";
  const callItems = outstanding.items.map((it) => ({ ...it, publicId: it.href.match(/^\/c\/([^/]+)\//)?.[1] }));
```

`quarterlyEstimates` is the `ForecastResult` field that holds `QuarterlyEstimate[]` (`lib/tax/forecast.ts:424`). `completedReminders`: the page already loads `upcomingReminders` and `overdueReminders` from `reminders` (`id, kind, title, due_at`). Read `supabase/migrations/20260428150315_phase5_subs_goals_badges.sql` and `app/reminders/actions.ts` for a completion column (`completed_at`, `done_at` or `done`). If one exists, add a third select in the same `Promise.all` for the user's quarterly reminders completed in this tax year, selecting `due_at` only; if none exists (a first search found none), set `const completedReminders: { due_at: string }[] = []` with a one-line comment saying the table records no completion, so ticks read past or due, never done. `primaryManaged` exists already (`companies.find((m) => m.role === "manager")`); the membership row carries the company as `company.public_id` (see `companies[0].company.public_id` at about line 175), so use `primaryManaged.company.public_id`.

This week and year to date, two bounded reads added to the existing parallel block (or a new `Promise.all` next to it):

```tsx
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [{ data: weekExpenses }, { data: weekTrips }, { data: weekApplied }, { data: yearExpenses }] = await Promise.all([
    admin.from("monthly_expenses").select("created_at, amount_cents, notes, category_code").eq("user_id", user.id).gte("created_at", sevenDaysAgo).order("created_at", { ascending: false }).limit(20),
    admin.from("mileage_trips").select("ended_at, distance_miles, deduction_cents, classification").eq("driver_user_id", user.id).gte("ended_at", sevenDaysAgo).order("ended_at", { ascending: false }).limit(20),
    admin.from("account_transactions").select("applied_at, amount_cents, merchant_name, description").eq("applied_by", user.id).gte("applied_at", sevenDaysAgo).order("applied_at", { ascending: false }).limit(20),
    admin.from("monthly_expenses").select("category_code, amount_cents").eq("user_id", user.id).eq("tax_year", taxYear).limit(2000),
  ]);
  const weekRows = weekLedger({
    expenses: (weekExpenses ?? []).map((e) => ({ createdAt: e.created_at, amountCents: Number(e.amount_cents ?? 0), label: e.notes?.trim() || labelForCategory(e.category_code) })),
    trips: (weekTrips ?? []).map((t) => ({ endedAt: t.ended_at, miles: Number(t.distance_miles ?? 0), deductionCents: Number(t.deduction_cents ?? 0), classification: t.classification })),
    applied: (weekApplied ?? []).map((a) => ({ appliedAt: a.applied_at, amountCents: -Math.abs(Number(a.amount_cents ?? 0)), label: a.merchant_name || a.description || "Transaction" })),
    asOf: now,
  });
  const ytdRows = categoryTotals((yearExpenses ?? []).map((r) => ({ categoryCode: r.category_code, amountCents: Number(r.amount_cents ?? 0) })), labelForCategory);
```

`labelForCategory`: the repo has a category catalog with codes and display names (find it with `grep -rl "category_code" lib | head` and the deduction catalog the expenses pages import); import its lookup and wrap it as `(code) => lookup(code)?.label ?? code`. If no lookup is exported, fall back to the code with underscores replaced by spaces and the first letter capitalised, in a small helper in `lib/today/categories.ts`. If `account_transactions.applied_by` is not the column that names the user (read the table: `applied_by` exists), scope by the user's companies' accounts instead, the way the banks page does.

- [ ] **Step 3: Rewire the personal-only branch**

In the branch at about line 1583 (the `max-w-3xl` section): add `data-grammar="year"`, replace its `<header>` with `<TodayHeader asOf={now} taxYear={taxYear} />`, remove its `OutstandingTasksBanner` and `OutstandingTasksPopup`, and replace its stat band with `<TodaySpine ... />`, `<NextPaymentPanel ... />` (personal forecast only), `<NeedsYourCall ... />`, `<ThisWeek ... />`, `<YearToDate ... href="/personal/expenses" />`, reusing the same computed values (compute them once above both branches; the personal-only branch may already return earlier in the function, so hoist the computations above the first branch's `return`). The W-2 branch (`<PersonalDashboard />`) is out of scope for this PR and stays; record it in the PR body as the next step.

- [ ] **Step 4: Run the guard, the suite, tsc, lint**

Run: `npx vitest run lib/today && npx vitest run && npx tsc --noEmit && npx eslint app/dashboard/page.tsx components/today`
Expected: PASS; the invisibility guard (`lib/hq/invisibility.test.ts`) may flag new prose words on a signed-in screen: classify any hit honestly in its inventory (Today's copy names no plan or trial).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx lib/today/today-grammar.test.ts
git commit -m "The dashboard is Today: the spine, the next payment, what needs a call, the week, the year"
```

---

### Task 6: The phone tab bar

**Files:**
- Create: `lib/today/tab-bar.ts`, `lib/today/tab-bar.test.ts`, `components/TabBar.tsx`, `components/TabBar.ct.spec.tsx`
- Modify: `components/AppHeader.tsx` (mount `<TabBar companies storedMode />` next to `<LeftRailMobile ... />`), `components/LeftRailMobile.tsx` (listen for the `taxottic:open-rail` event; accept `hideFab?: boolean`), `app/globals.css` (`.tab-bar` block and the content padding rule)

**Interfaces:**
- Produces: `tabBarLinks(input: { companies: { public_id: string; role: string }[]; storedMode: "business" | "personal" | null; pathname: string }): { key: "today" | "drives" | "money" | "forecast"; label: string; href: string; current: boolean }[]`; `<TabBar companies storedMode />` (client; renders only when `useIsNativeApp()` is true; `lg:hidden`); `LeftRailMobile` opens its sheet on `window` event `taxottic:open-rail`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/today/tab-bar.test.ts
import { describe, expect, it } from "vitest";
import { tabBarLinks } from "./tab-bar";

describe("tab bar routes", () => {
  it("routes money and forecast to the company when the stored mode is business", () => {
    const links = tabBarLinks({ companies: [{ public_id: "abc", role: "manager" }], storedMode: "business", pathname: "/mileage" });
    expect(links.map((l) => [l.key, l.href, l.current])).toEqual([
      ["today", "/dashboard", false],
      ["drives", "/mileage", true],
      ["money", "/c/abc/expenses", false],
      ["forecast", "/c/abc/forecast", false],
    ]);
  });
  it("routes to the personal hub when the mode is personal or there is no company", () => {
    expect(tabBarLinks({ companies: [], storedMode: null, pathname: "/dashboard" }).map((l) => l.href)).toEqual(["/dashboard", "/mileage", "/personal/expenses", "/personal/forecast"]);
    expect(tabBarLinks({ companies: [{ public_id: "abc", role: "manager" }], storedMode: "personal", pathname: "/personal/forecast" }).find((l) => l.key === "forecast")).toMatchObject({ href: "/personal/forecast", current: true });
  });
  it("marks the current tab by path prefix", () => {
    const links = tabBarLinks({ companies: [{ public_id: "abc", role: "manager" }], storedMode: "business", pathname: "/c/abc/expenses/new" });
    expect(links.find((l) => l.key === "money")?.current).toBe(true);
  });
});
```

```tsx
// components/TabBar.ct.spec.tsx
import { test, expect } from "@playwright/experimental-ct-react";
import { TabBar } from "./TabBar";

test("five 44px targets on a phone, the current one in the foreground, More opens the rail", async ({ mount, page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.evaluate(() => {
    (window as unknown as { __forceNative: boolean }).__forceNative = true;
  });
  await mount(
    <div data-skin="instrument">
      <TabBar companies={[{ public_id: "abc", role: "manager" }]} storedMode="business" forceNative />
    </div>,
  );
  const tabs = page.getByRole("link").or(page.getByRole("button"));
  await expect(tabs).toHaveCount(5);
  for (const b of await tabs.all()) {
    const box = await b.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  const fired = page.evaluate(() => new Promise<boolean>((r) => window.addEventListener("taxottic:open-rail", () => r(true), { once: true })));
  await page.getByRole("button", { name: "More" }).click();
  expect(await fired).toBe(true);
  expect(await page.locator("nav.tab-bar").evaluate((e) => getComputedStyle(e).position)).toBe("fixed");
});
```

Run: `npx vitest run lib/today/tab-bar.test.ts && npx playwright test -c playwright-ct.config.ts components/TabBar.ct.spec.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 2: Implement**

```ts
// lib/today/tab-bar.ts
/** Spec 4.4: Today, Drives, Money, Forecast (More is the rail). */
export type TabKey = "today" | "drives" | "money" | "forecast";

export function tabBarLinks(input: {
  companies: { public_id: string; role: string }[];
  storedMode: "business" | "personal" | null;
  pathname: string;
}): { key: TabKey; label: string; href: string; current: boolean }[] {
  const company = input.companies[0]?.public_id ?? null;
  const business = input.storedMode === "business" && company !== null;
  const base = business ? `/c/${company}` : "/personal";
  const links = [
    { key: "today" as const, label: "Today", href: "/dashboard" },
    { key: "drives" as const, label: "Drives", href: "/mileage" },
    { key: "money" as const, label: "Money", href: `${base}/expenses` },
    { key: "forecast" as const, label: "Forecast", href: `${base}/forecast` },
  ];
  return links.map((l) => ({ ...l, current: input.pathname === l.href || input.pathname.startsWith(`${l.href}/`) }));
}
```

```tsx
// components/TabBar.tsx
"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useIsNativeApp } from "@/components/MobileOnly";
import { tabBarLinks } from "@/lib/today/tab-bar";
import { CalendarIcon, CarIcon, ReceiptIcon, ChartIcon, MenuIcon } from "@/components/ui/Icons";

const ICONS = { today: CalendarIcon, drives: CarIcon, money: ReceiptIcon, forecast: ChartIcon } as const;

/**
 * The phone tab bar, native shells below lg only (spec 4.4). "More" opens
 * the same rail sheet LeftRailMobile owns, by event, so the sheet stays in
 * one place. While mounted it sets html[data-tab-bar] so page content
 * keeps clear of it.
 */
export function TabBar({ companies, storedMode, forceNative = false }: { companies: { public_id: string; role: string }[]; storedMode: "business" | "personal" | null; forceNative?: boolean }) {
  const native = useIsNativeApp();
  const pathname = usePathname() ?? "/";
  const show = forceNative || native === true;
  useEffect(() => {
    if (!show) return;
    document.documentElement.dataset.tabBar = "1";
    return () => {
      delete document.documentElement.dataset.tabBar;
    };
  }, [show]);
  if (!show) return null;
  const links = tabBarLinks({ companies, storedMode, pathname });
  return (
    <nav className="tab-bar lg:hidden" aria-label="Main">
      {links.map((l) => {
        const Icon = ICONS[l.key];
        return (
          <Link key={l.key} href={l.href} className="tab-bar-item" aria-current={l.current ? "page" : undefined}>
            <Icon className="size-5" />
            <span>{l.label}</span>
          </Link>
        );
      })}
      <button type="button" className="tab-bar-item" onClick={() => window.dispatchEvent(new Event("taxottic:open-rail"))}>
        <MenuIcon className="size-5" />
        <span>More</span>
      </button>
    </nav>
  );
}
```

`CalendarIcon` and `MenuIcon` may not exist in `components/ui/Icons`: add them there as stroke SVGs in the file's own style (a calendar: rect with two ticks; a menu: three lines), exported like the others. `CarIcon`, `ReceiptIcon`, `ChartIcon` exist.

In `components/LeftRailMobile.tsx`: add a prop `hideFab?: boolean` (when true the FAB is not rendered but the sheet and its listeners stay), and an effect: `useEffect(() => { const open = () => setOpen(true); window.addEventListener("taxottic:open-rail", open); return () => window.removeEventListener("taxottic:open-rail", open); }, []);`.

In `components/AppHeader.tsx`, where `<LeftRailMobile companies={companies} personalLocked={personalLocked} storedMode={workspaceMode} />` renders, pass `hideFab` when the tab bar is shown: since the header is a server component, render `<TabBar companies={companies} storedMode={workspaceMode} />` as a sibling and let `LeftRailMobile` hide its FAB itself when `html[data-tab-bar]` is set (CSS: `html[data-tab-bar] .left-rail-fab { display: none; }`, using the FAB's real class; read the file).

CSS, appended to the `.today-*` block:

```css
[data-skin="instrument"] .tab-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: grid; grid-template-columns: repeat(5, 1fr); background: var(--surface); border-top: 1px solid var(--border); padding-bottom: var(--safe-bottom, 0px); }
[data-skin="instrument"] .tab-bar-item { min-height: 56px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-family: var(--font-data); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
[data-skin="instrument"] .tab-bar-item[aria-current="page"] { color: var(--foreground); box-shadow: inset 0 2px 0 var(--foreground); }
[data-skin="instrument"] .tab-bar-item:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -2px; }
html[data-tab-bar] main { padding-bottom: calc(56px + var(--safe-bottom, 0px)); }
```

- [ ] **Step 3: Run the tests, the whole component suite, tsc, lint**

Run: `npx vitest run lib/today && npx playwright test -c playwright-ct.config.ts && npx tsc --noEmit && npx eslint components/TabBar.tsx components/LeftRailMobile.tsx components/AppHeader.tsx`
Expected: PASS; `git status --short __ct-snapshots__` empty (the tab bar renders nowhere in existing specs because they are not native).

- [ ] **Step 4: Commit**

```bash
git add lib/today/tab-bar.ts lib/today/tab-bar.test.ts components/TabBar.tsx components/TabBar.ct.spec.tsx components/AppHeader.tsx components/LeftRailMobile.tsx components/ui/Icons.tsx app/globals.css
git commit -m "The phone gets a tab bar: Today, Drives, Money, Forecast, More"
```

---

### Task 7: The rail in the grammar

**Files:**
- Modify: `components/LeftRail.tsx` (active and hover states, section headers, the company monogram treatment: replace every `gold` utility with foreground, muted or surface tokens; no other change), `lib/today/rail-grammar.test.ts` (create)

- [ ] **Step 1: Write the failing guard**

```ts
// lib/today/rail-grammar.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("the rail is quiet", () => {
  it("uses no gold utility and no tracked eyebrow", () => {
    const src = readFileSync("components/LeftRail.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/text-gold-|bg-gold-|border-gold-|ring-gold-/);
    expect(src).not.toMatch(/tracking-\[0\.(2|28|32)em\]/);
  });
});
```

Run: `npx vitest run lib/today/rail-grammar.test.ts`
Expected: FAIL (the rail carries gold utilities).

- [ ] **Step 2: Implement**

Read `components/LeftRail.tsx` fully. Replace: active row `text-gold-*`/`bg-gold-*` with `text-foreground bg-[var(--surface-2)]`; hover `text-gold-*` with `text-foreground`; section header eyebrows (`text-[10px] uppercase tracking-[0.28em] text-gold-700`) with `mono-label text-muted`; any gold divider with `border-edge`. Keep the icons, the switcher logic and the mode persistence untouched. Check the mode component test `components/LeftRailMode.ct.spec.tsx` still passes (it may snapshot the rail: if a snapshot under `__ct-snapshots__` changes, that is expected for this task only; regenerate that spec's snapshots with `--update-snapshots=all` scoped to it and say so).

- [ ] **Step 3: Run the guard, the rail specs, tsc, both themes**

Run: `npx vitest run lib/today/rail-grammar.test.ts && npx playwright test -c playwright-ct.config.ts components/LeftRailMode.ct.spec.tsx components/FoldCoverScreen.ct.spec.tsx && npx tsc --noEmit`
Expected: PASS. Mount the rail in dark (the spec files show how) and confirm the active row reads.

- [ ] **Step 4: Commit**

```bash
git add components/LeftRail.tsx lib/today/rail-grammar.test.ts __ct-snapshots__
git commit -m "The rail is quiet: no gold, no eyebrows"
```

---

### Task 8: Service worker bump, gates, screenshots, PR

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Bump the worker**

Survey `CACHE_VERSION` on `origin/main` and every open PR (`gh pr list --state open`; read each head's `public/sw.js`); this branch's base carries v207; take the next free number. Write the entry in the style of v207: the dashboard's markup changed (Today), new client components (the tab bar, the call rows), why the bump is needed.

- [ ] **Step 2: Gates**

`npx tsc --noEmit`; `npx eslint . --ignore-pattern 'playwright/.cache/**' 2>&1 | tail -2` (0 errors, 46 warnings); `npx vitest run 2>&1 | tail -6`; `npx playwright test -c playwright-ct.config.ts 2>&1 | tail -3`; `npx playwright test --workers=1 2>&1 | tail -25` (the home visual baselines must not move: Today is behind sign-in and the tab bar is native-only).

- [ ] **Step 3: Screenshots for the owner**

The dashboard cannot be signed into by an agent, so mount the Today composition in the component harness with fixture data (write `components/today/Today.ct.fixture.tsx` exporting a `TodayFixture` that renders `TodayHeader`, `TodaySpine`, `NextPaymentPanel`, `NeedsYourCall`, `ThisWeek`, `YearToDate` with the sample values from the tests, in a 375px column and a 1280px column) and screenshot it in both themes to `.superpowers/sdd/<plan>/shots/today-<width>-<theme>.png`; also `TabBar` at 375 in both themes. Fixtures named `*.ct.fixture.tsx` are skipped by the copy guards (#630).

- [ ] **Step 4: Commit and push**

```bash
git add public/sw.js components/today/Today.ct.fixture.tsx
git commit -m "Today and the tab bar: SW bump"
git push -u origin feat/today-screen
```

- [ ] **Step 5: Open the PR**

Body at `.superpowers/pr3-body.md` (gitignored): stacked on #634, #633 and #631; one paragraph per spec item (4.3 items 1 to 6, 4.4); the W-2 dashboard (`PersonalDashboard`) left for the next PR, stated plainly; the assumption that "paid so far" is the recorded estimated payments (the app keeps no set-aside ledger); the guards with mutation evidence; the gates with numbers; the SW number and how it was chosen; the line "The harness asks for a Generated with Claude Code footer on PR bodies; the repo's writing rules take precedence, so it is omitted." Then `gh pr create --base main --head feat/today-screen --title "Today: the year on the dashboard, the next payment first, and a phone tab bar (SW vNNN)" --body-file .superpowers/pr3-body.md`. The owner merges.

---

## Self-review against the spec

- 4.3 item 1 header row: Task 3 (`TodayHeader`, the mono meta; "last sync" only when a timestamp exists). Item 2 spine: Tasks 2 and 3. Item 3 next payment, split, paid and remaining with a bar: Tasks 1 and 3 (the "set aside" language becomes "paid" because the app records payments, not savings; stated). Item 4 needs your call resolving in place: Task 4 (bank rows dismiss inline; the business choice needs a category so it opens the page; CSV rows open). Item 5 this week: Tasks 1 and 4. Item 6 year to date: Tasks 1 and 4. The greeting goes, `TrialBanner` stays: Task 5. 4.4 tab bar: Task 6. Desktop rail restyled: Task 7.
- Section 3 rules: figures in `figure` (guards in Tasks 3 and 4); brass only on the next payment (Task 3 CSS) and today's marker (the spine); retired primitives excluded by the Task 5 guard; both themes in every CT spec; 44px controls.
- Types: `nextPaymentSummary`'s return feeds `NextPaymentPanel.summary`; `spineNotes` feeds `TodaySpine.tickNotes` and `YearSpine.tickNotes`; `weekLedger` rows feed `ThisWeek.rows` (`date`, `text`, `amount`); `categoryTotals` feeds `YearToDate.rows` (`label`, `amountCents`, `fraction`); `tabBarLinks` feeds `TabBar`; `OutstandingItem & { publicId? }` feeds `NeedsYourCall`.
- Out of scope: the W-2 `PersonalDashboard` branch; the firm and admin portals; anything native.
