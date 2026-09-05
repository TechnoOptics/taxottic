# The year is the interface: marketing site and app revamp

Date: 2026-09-05. Branch: `design/year-interface`, off `origin/main` at `1e2ce98`.
Approved by the owner on 2026-09-05 from the mockups in
`.superpowers/brainstorm/21367-1788630488/content/direction-a-mockups-v2.html`
("keep everything").

## 1. Brief

The owner's words: the site and app "look and feel so AI", and the buyer is a
corporate client. The bar is a premium, current product that could not be
mistaken for a template.

The 2026-09-05 audit (eleven public pages at 1280 and 375, the sample
dashboard, the app on an iPhone 17 Pro simulator and a Pixel-class Android
emulator) found the palette is not the problem; the Instrument skin already
moved off cream, serif and gold. The grammar is the problem:

- One section template repeated eleven times: tracked gold eyebrow, big
  heading, paragraph, then pill chips or a card grid.
- Mock "Company X, LIVE" product windows instead of the product.
- Four stock photographs.
- A reassuring register (calmer, gentle, quietly) with an italic tagline under
  every card.
- A stats band and a manifesto.
- The one distinctive object, the tax-year runway with mono figures, appears
  once and is never used again.
- The native app opens on the marketing page with Sign in as the third action;
  Android asks for notification permission on that page before sign-in; the
  iOS login page has a hard-coded navy band over a light page.
- The dashboard opens with a randomised greeting as its headline.

## 2. Thesis

Taxottic's subject is where you are in the tax year and what that means in
dollars. So the tax-year runway becomes the spine of every screen, marketing
and app alike, and everything on a page hangs off a date. Structure encodes
something true: the year is a sequence, the payments have dates, today is a
point on the line.

Boldness is spent in one place, the spine. Everything around it is quiet.

## 3. Design system decisions (the "Year" grammar)

All values below are existing tokens in `app/globals.css` under
`[data-skin="instrument"]` unless marked NEW. No new colours.

### Palette

| Role | Token | Value |
| --- | --- | --- |
| Ground | `--background` | `#f2f5f8` cool paper |
| Surface | `--surface` | `#ffffff` |
| Recessed surface | `--surface-2` | `#e9eef4` |
| Ink | `--foreground` | `#0c1017` |
| Muted | `--muted` | `#4c5766` |
| Rules | `--border`, `--border-bright` | 10% and 18% ink |
| Instrument panel | `--navy-band` | the three-stop navy gradient |
| Brass | `--accent-2` on navy, `--kicker` on paper | `#c0973f`, `#8a6a1c` |

Brass rule: brass appears on exactly two things, today's marker and the live
figure (next payment or the estimate). Dates in the eyebrow position may be
brass on paper because they are the "today" fact. Nothing else is brass: no
eyebrows, no rings, no dividers, no bullets, no gold-shine.

Navy rule: the navy band is reserved for the instrument panel. Page heroes sit
on paper. The marketing nav sits on paper with a hairline under it. (This
retires the navy header band on every marketing page and on `/login`.)

### Type

The three faces already loaded in `app/layout.tsx` stay. Their roles change.

| Role | Face | Setting |
| --- | --- | --- |
| Display | Archivo | NEW: the `wdth` axis at 112 (SemiExpanded), weight 600, tracking -0.025em, line-height 1.02. `next/font` declares `axes: ["wdth"]`. |
| Body | Hanken Grotesk | 400/500/600, unchanged |
| Data | IBM Plex Mono | every date, every figure, every countdown, tabular numerals, weight 500 for figures |

Type scale (desktop / phone): h1 66/38, section h2 30/24, moment h3 30/24,
lede 19/16, body 16/14, mono labels 11 to 13 with 0.04 to 0.12em tracking.

Retired primitives: the tracked gold eyebrow (`.kicker` usage above headings),
pill chips, italic taglines, `gold-shine`. The `--kicker` token stays for
brass-on-paper text.

### Signature: the year spine

One component, `components/YearSpine.tsx`, rendered from
`lib/marketing/tax-year-runway.ts` (`taxYearRunway(taxYear, asOf)`), which
already computes the ticks and today's position. Two variants:

- `spine` (paper): a 2px track, ticks at Jan 15, Apr 15, Jun 15, Sep 15 and the
  following Jan 15, mono labels beneath, brass fill from the left to today,
  today's marker in brass with a mono `TODAY · SEP 5` label above. A mono row
  above it carries `TAX YEAR 2026` at left and the countdown to the next due
  date at right.
- `panel` (navy): the same geometry inside the instrument panel, as
  `HeroInstrument` draws it today.

On the marketing home the spine is `position: sticky` under the nav. As the
reader scrolls through the dated sections the fill advances to that section's
date and the today marker stays put, so the reader can see the distance
between a section's moment and today. On other pages it is static. On the app
Today screen it is static and its labels say what happened at each tick
(`Apr 15 · Q1 paid`).

Today is real on the app. On marketing pages today is a fixed sample date, as
`HeroInstrument` does now, so visual baselines do not drift; the label says
`SAMPLE`.

### Real product screens

`components/marketing/Screen.tsx` NEW: a white surface with a hairline border,
a mono title bar (`SCHEDULE C · 2025` at left, a status at right) and a body.
It renders the product's own row primitives (stat row, transaction row, drive
row, category bar, ledger row) styled exactly as the app renders them, with
sample data. This replaces the eight `*Mockup` functions and `MockupFrame`.
No `Company X` chrome, no `LIVE` badge, no green pills.

### Copy register

Plain, specific, present tense. Name the date, the number, the form line. No
calmer, gentle, quietly, friendly, scary. No italics for emphasis. Buttons say
what happens: "See the sample account", "Send code", "Export Schedule C". The
disclaimer stays on every marketing page and on sign-in.

### Motion

One orchestrated moment on the home page load: the spine track draws left to
right (400 ms), the today marker lands (150 ms), the next-payment figure
settles from 0 to its value (500 ms, mono, tabular so nothing shifts). Then the
scroll-linked fill. Nothing else animates. `prefers-reduced-motion` renders
the final state immediately.

### Quality floor

Responsive from 344 up. Visible focus rings (brass, 2px) on every control.
Both app themes checked for every app change. No horizontal overflow at any
width. No emoji. Icons are stroke SVGs from `components/ui/Icons`.

## 4. Surfaces

### 4.1 Marketing home (`app/page.tsx`)

Structure, top to bottom:

1. Nav on paper: wordmark, Home, Pricing, Guides, Calculators; at right Sign in
   (quiet) and See the sample account (primary).
2. Year spine, sticky.
3. Hero on paper, two columns from `lg`: left, a brass mono eyebrow with the
   sample date and days into the year; h1 "Your taxes, as of today."; lede;
   primary and quiet buttons with "Free to look. No card." beside them. Right,
   the instrument panel: panel spine, next payment (brass), set aside so far,
   still to set aside, then a three-line ledger of what moved this week.
   Phone: stacked, panel after the actions.
4. The audience switch. The three audiences stay (personal, business, firm)
   because pricing and guidance follow them, but the pill control in the navy
   band goes. It becomes a compact mono segmented control on the row under the
   spine ("FOR ME · FOR MY BUSINESS · FOR MY FIRM"), switching the hero copy,
   the panel's sample figures and the dated sequence's copy, as
   `AudienceToggle` switches them today.
5. "A tax year, the way Taxottic runs it": the dated sequence. Five moments,
   each a three-column row on desktop (date in mono, headline and paragraph
   and a text link, a real product screen) and stacked on the phone:
   - Apr 15, Q1 payment and last year's return: Schedule C screen.
   - Jun 15, Q2 payment: this week's bank feed with a "Your call" row and the
     Q2 estimate moving.
   - Jul to Sep, on the road: drives screen with map and three trips.
   - Sep 15, Q3 payment: estimate, set aside, still to set aside, a bar.
   - Dec, before the year closes: the playbook with priced moves.
   Firm audience: the same five moments described from the practice's side
   (client rosters, bulk export), same screens with firm sample data.
6. Pricing strip: "Free to look around. Solo from $19.99 a month." with a
   mono line of the other tiers and a quiet See pricing button. Prices come
   from the same source `app/pricing/page.tsx` uses; no new claims.
7. Footer: one-line disclaimer, links (Help, Guides, Changelog, Privacy,
   Terms, Legal hub), Techno Optics line, store badges as plain links.

Removed: `HeroFigure` photograph, `Capabilities` grid, `WhoItsFor` photo
cards, `ProductTour` and the eight `*Mockup` functions and `MockupFrame`,
`ProofBand`, `FomoBand`, `FinalCta` in its card form. `AppDownloadBanner` stays
on phones (the #631 compact strip).

### 4.2 Secondary marketing pages

Pricing, Calculators, Guides, Compare, Help, Changelog, Book (and its firm
variant), Login. Each gets the paper nav and a static spine under it, then the
page's content in the Year grammar:

- Headings in wide Archivo, no eyebrow. Where a page had an eyebrow that said
  something (Guides, Changelog) the h1 says it instead.
- Card lists become ledger lists: a hairline-separated list with a mono date
  or figure column where one exists (Changelog: date; Pricing: price;
  Calculators and Guides: no figure, so a plain list with the title as the
  link).
- Pricing: the six tiers as one ruled table on desktop (tier, who it is for,
  price in mono, what it includes) and a stacked ledger on the phone. The
  "Yearly saves ~17%" line stays in the h1 as #631 set it.
- Login: on paper, wordmark, "Sign in", passkey first, then Apple and Google
  (Microsoft stays but moves below the fold on phones), then a one-time code
  by email. The human check stays. The dark top band goes (see 4.5).

### 4.3 App: Today (`app/dashboard/page.tsx`)

The dashboard becomes Today. Order:

1. Header row: "Today" in wide Archivo, mono at right with the date, tax year
   and last sync.
2. Year spine, static, real today, ticks labelled with what happened
   (`Apr 15 · Q1 paid`).
3. Next payment: the live figure in brass mono at 44/52px, federal and state
   split beside it, then set aside so far and still to set aside as stat rows
   with a progress bar.
4. Needs your call: the outstanding drives and transactions
   (`getOutstandingTasks`) as rows with an inline two-way segmented control
   (Business / Personal, Yes 50% / No) that resolves in place. This replaces
   `OutstandingTasksBanner` and `OutstandingTasksPopup` on this screen.
5. This week: the ledger of what moved the number, three to seven rows, each
   with a mono date and a signed mono amount.
6. Year to date: deductions by category with bars, as the sample shows.

The greeting (`buildGreeting`) is dropped from the headline. `TrialBanner`
stays, below the spine, in its #629 form. Desktop keeps `LeftRail`, restyled
to the grammar (stroke icons, quiet rows, no gold). The personal and business
data sources are unchanged; this is a presentation change.

### 4.4 App: phone tab bar

`components/TabBar.tsx` NEW, native platforms and viewports under `lg` only:
Today, Drives, Money, Forecast, More. Stroke icons from `components/ui/Icons`.
"More" opens the existing rail as a sheet. `safe-pad-bottom` applies. The rail
stays on desktop.

### 4.5 Native shell

- First screen: signed-out native launches land on `/login`, not `/`.
  `app/page.tsx` already redirects signed-in users to `/dashboard`; it gains
  the mirror rule for native (detected the way `MobileOnly` detects it) so the
  marketing page is never the app's first screen.
- Permission timing: `CapacitorNativeInit` registers for push on every cold
  start, which on Android raises the system prompt before sign-in. Registration
  moves behind two gates: a session exists, and the user has reached Today
  once. Location permission is already requested only when tracking is turned
  on and stays that way.
- Top band: `body::before` paints a fixed `#121a2a` strip under the status bar
  on every page. It becomes `var(--background)` on paper pages and navy only
  where the page's own header is navy, by reading the same attribute the
  header uses. The iOS status bar style follows (`Style.Dark` text on paper).
- Any client JS or markup change bumps `CACHE_VERSION` in `public/sw.js`,
  chosen against `origin/main` and open PRs at the moment of the bump.

## 5. What is out of scope

- The firm and admin portals beyond `LeftRail` and the shared primitives.
- Any pricing, trial-length, firm pricing or e-filing claim. Copy carries only
  what the current pages already claim.
- New photography. None is used.
- A new native build for the WebView pages (they ship with the web). The
  permission-timing and status-bar changes in 4.5 are web-side and ship the
  same way; only if a native-layer change proves necessary does a build follow.

## 6. Delivery, one PR per phase

Each PR: tsc clean, eslint at baseline, vitest green, component tests green,
visual baselines regenerated for the pages it touches, `CACHE_VERSION` bumped,
before and after screenshots at 1280, 375 and 344 sent to the owner, both
themes for app surfaces, no em dashes, no emoji. The owner merges.

1. **Foundations and home.** Archivo `wdth` axis, `YearSpine`, `Screen` and
   the row primitives, the home page rebuilt, the retired primitives and
   mock components deleted, guards updated (`hero-first-screen.test.ts`,
   `marketing-skin.test.ts`, `e2e/marketing-typography.spec.ts`,
   `e2e/visual.spec.ts` baselines). Depends on #631 merging first; the branch
   rebases onto it.
2. **Secondary marketing pages and the shell.** Nav, footer, the eight pages
   in 4.2, `e2e/public-marketing.spec.ts` and `help-pricing.spec.ts` updated.
3. **Today and the rail.** 4.3 and the desktop rail.
4. **Tab bar and the native shell.** 4.4 and 4.5.

## 7. Guards this design adds

- `lib/marketing/year-grammar.test.ts`: the marketing pages contain no
  `gold-shine`, no `.kicker` above an `h1`/`h2`, no chip lists, no italic
  tagline pattern, and no `*Mockup` component; every date and money figure is
  inside a `.figure` or `.mono` element. Comments stripped before matching.
- `lib/marketing/year-spine.test.ts`: the spine is rendered on every page in
  4.1 and 4.2 and on Today, and its today position equals
  `taxYearRunway().todayFraction`.
- `e2e/marketing-typography.spec.ts` extended: h1 line counts at 1280, 375 and
  344; the spine's rendered width and today marker position at each.
- `lib/native/first-screen.test.ts`: a signed-out native request to `/`
  redirects to `/login`; push registration is not invoked without a session.
  Mutation-tested: remove the gate and the test names the file and line.
- Existing guards that must keep passing: `purchase-controls.test.ts`,
  `hq/invisibility.test.ts`, `ground-colour.spec.ts`, `sitemap-public.spec.ts`.

## 8. Assumptions stated

- Archivo's `wdth` axis is available from Google Fonts through `next/font`
  with `axes: ["wdth"]`; if the build rejects it, `font-stretch` is dropped
  and tracking tightens to -0.03em instead, with the owner told.
- The sample figures on marketing pages are the ones the current hero and
  `/example` already use, and every one is labelled `SAMPLE`.
- The audience switch keeps its query parameter behaviour so links into a
  specific audience keep working.
