# Marketing home: the first screen as an instrument

Date: 2026-09-03. Branch: `feat/marketing-first-screen`, off `origin/main` at `27e655f`.

## Brief

The owner asked for the marketing site and app interface to be improved, with a
standing bar of "world-class" and a buyer who is a corporate client. The task
was scoped to: audit with evidence, ship the single highest-impact fix as one PR,
report the rest as a ranked backlog.

This spec covers the one PR. The audit and backlog live in the PR description
and the session report.

## Assumptions (non-interactive session, stated rather than asked)

1. The Instrument skin stays. This is a refinement inside it, not a second
   redesign. Every colour and typeface below is an existing token.
2. The first screen a buyer sees is the home hero at desktop, and the home
   hero at phone width. Pricing is the second most-seen surface; it is in the
   backlog, not this PR.
3. Sample figures in the hero panel are acceptable because the page already
   establishes that convention lower down (the "Company X" product tour), and
   because the panel labels itself "Sample". No pricing, trial-length, firm
   pricing or e-filing claims are added or changed.
4. The runway's "today" position is a FIXED sample date, not the real clock.
   The real clock would move the visual baselines every day and the tax-year
   constants every January; a labelled sample is deterministic and honest.
5. The hero's navy field keeps its existing hard-coded gradient. Converting it
   to tokens is a separate, larger change (the same gradient is repeated on
   five pages and the app header).

## What the audit found on the first screen

Screenshots: `scratchpad/audit/home-desktop.png`, `home-m375.png`,
`home-m344.png` (paths in the session report).

1. Desktop: the right 45% of the first screen is empty navy. The photograph,
   the one thing that gives the page identity, sits below the fold at 1280x800.
   The buyer's first screen is a headline and a paragraph.
2. The Instrument skin defines its own signature, the tax-year runway
   (`.runway*` in `app/globals.css`, with a comment saying the hero loses
   information without it), and it is rendered nowhere. `grep runway app
   components` returns zero call sites. The signature was built and never
   invoked.
3. The h1 uses `gold-shine`, an animated gradient sweep, on the largest text on
   the page. The skin's own rule is brass in one place (the live figure and
   today's marker). `gold-shine` appears ten times on the home page; the h1 is
   where it costs the most.
4. Phone (375 and 344): the audience toggle wraps every label to two lines
   ("For / me", "For my / business") on the first screen. It reads as broken.

## Design

### Thesis

The hero's job is to say "this is a precision instrument for money" before the
reader has read a sentence. The left column keeps the promise (headline, copy,
actions). The right column shows the instrument: where the reader sits in the
tax year, and what that means in dollars.

### Layout

```
desktop (lg+)
+------------------------------------------------------------------+
| [For me | For my business | For my firm]                          |
|                                                                   |
| A calmer way to handle          +------------------------------+ |
| your personal taxes.            | TAX YEAR 2026 . SAMPLE       | |
|                                 |                              | |
| Taxottic tracks the ...         | ---|-------|----o---|------- | |
|                                 | Apr 15  Jun 15  Sep 15 Jan 15| |
| [Take a look around] [Pricing]  |                              | |
|                                 | Next payment  Q3 . Sep 15    | |
| NO CREDIT CARD. NO COMMITMENT.  |               $3,420  (brass)| |
|                                 | Set aside so far    $2,150   | |
|                                 +------------------------------+ |
+------------------------------------------------------------------+

phone (<lg): toggle, headline, copy, actions, footnote, then the panel.
```

### Tokens (all existing, nothing new)

The panel is wrapped in `<div class="skin-scope" data-skin="instrument"
data-theme="dark">`. The selector
`[data-skin="instrument"][data-theme="dark"]` already exists in
`app/globals.css`, so every token inside the panel flips to the skin's dark
values without a single literal hex in the component:

| Role | Token | Value inside the panel |
| --- | --- | --- |
| panel surface | `--surface` | `#131a24` |
| hairline | `--border` | `rgba(255,255,255,0.07)` |
| runway rail and ticks | `--border-bright` | `rgba(192,151,63,0.38)` |
| runway fill, today marker, the one live figure | `--accent-2` | `#d4ae5c` |
| kicker | `--kicker` | `#d4ae5c` |
| text | `--foreground` | `#eef2f7` |
| secondary text | `--muted` | `rgba(238,242,247,0.60)` |
| figures | `--font-data` via `.figure` | IBM Plex Mono, tabular |

`.skin-scope` is `display: contents`, so the wrapper paints no background of
its own; the `.card` inside paints `--surface`.

The h1 loses `gold-shine` and sets in the existing cream (`text-cream`) so the
brass on the first screen is spent once, on the instrument.

### The runway, as data

`lib/marketing/tax-year-runway.ts` exports one pure function:

```ts
taxYearRunway(taxYear: number, asOf: Date): {
  ticks: { quarter: 1|2|3|4; label: string; date: string; at: number }[];
  fill: number;            // 0..1, clamped
  next: Tick | null;       // first tick whose date >= asOf, null after Q4
  daysToNext: number | null;
}
```

Span: 1 January of the tax year to the Q4 due date (15 January of the following
year), which is the last tick and sits at `at = 1`. Positions are UTC day
fractions along that span. Due dates come from
`lib/tax/constants-2026.ts` `QUARTERLY_DUE_DATES_2026`, not retyped.

The hero passes a fixed sample `asOf` of `2026-08-20T00:00:00Z`.

### Components

- `components/HeroInstrument.tsx` (server component, no client JS): the panel.
  Props: `taxYear`, `asOf`, `nextPaymentCents`, `setAsideCents`. Renders the
  kicker, the runway (rail, fill, four ticks with labels, today marker), and
  two rows. Figures use `.figure`. Money is formatted with the existing
  `formatCents` from `lib/tax/engine/money.ts`.
- `components/AudienceToggle.tsx`: extracted from `app/page.tsx` unchanged in
  behaviour, plus the phone fix: below `sm` the tablist is a full-width
  three-column grid, labels `text-xs whitespace-nowrap text-center`; at `sm`
  and above it is the existing inline pill.
- `app/page.tsx`: `Hero` becomes a two-column grid at `lg`
  (`lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center`), imports
  the two components, and drops `gold-shine` from the three `HERO[*].head`
  nodes.

### Copy

- Kicker: "Tax year 2026 · Sample"
- Tick labels: "Apr 15", "Jun 15", "Sep 15", "Jan 15" (from the constants)
- Row 1 label: "Next payment", detail "Q3 · due Sep 15 · 26 days", figure
  "$3,420"
- Row 2 label: "Set aside so far", figure "$2,150"
- Foot: "Federal + state, in step with your bank. Illustrative figures."

No new claims. "In step with your bank" is existing hero copy.

### Motion

None added. The `gold-shine` animation is removed from the h1, so the first
screen has less motion than before. Reduced-motion needs nothing new.

### Accessibility

- The runway is decorative to a screen reader (`aria-hidden`); the two rows
  carry the same information as text.
- Tick labels are real text, not pseudo-elements.
- Toggle keeps `role="tablist"`, `role="tab"`, `aria-selected`.

## Testing

TDD order, each test watched to fail first:

1. `lib/marketing/tax-year-runway.test.ts` (vitest): four ascending ticks, Q4
   at 1.0, Q1 at the correct day fraction; fill clamps at 0 and 1; `next` is
   inclusive of the due date and null after Q4; `daysToNext` for the sample
   date is 26.
2. `lib/marketing/hero-first-screen.test.ts` (vitest, source-level, comments
   stripped): (a) no `gold-shine` inside the `HERO` record of `app/page.tsx`;
   (b) `HeroInstrument` renders the `.runway` signature and `app/page.tsx`
   renders `HeroInstrument` inside `Hero`. Both mutation-tested by
   reintroducing the defect and watching the test fail.
3. `components/AudienceToggle.ct.spec.tsx` (Playwright CT, Fold cover 344px):
   every tab is a single line (height under 40px), no tab overflows the
   viewport, document does not scroll sideways. No screenshot assertion, so
   no new CT baselines.
4. Visual baselines: `home` desktop and mobile regenerate (darwin locally,
   linux via the manual `visual-baselines` workflow on this branch) and are
   committed. The other seven public pages are untouched.

Gates: `npx tsc --noEmit`, `npx eslint lib app components`, `npx vitest run`,
`npm run e2e:visual` against the regenerated baselines, `npm run test:ct`.

`public/sw.js` `CACHE_VERSION` bumps to v200 with a changelog line (client
markup changed).

## Out of scope (backlog, reported separately)

Pricing h1 orphan and centred layout, the remaining nine `gold-shine` sites,
the hero sub-copy length, the App Store banner's share of the phone first
screen, `/firms` header wrap, the hard-coded navy gradient on five pages, and
the dashboard first paint (needs a session to audit).
