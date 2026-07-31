# Design system extracted from Techottic

Source of truth: `/Users/technooptics/Techottic` (read-only reference, never modified).
Target: this repo's web portals (Next.js 16, Tailwind v4, React 19).

Every value below was read out of the Techottic source, not inferred. File
references are relative to the Techottic repo root.

Techottic is a small, deliberately dense system. Its whole design language
lives in five files:

| File | Role |
| --- | --- |
| `src/app/globals.css` (145 lines) | token layer, base, primitives |
| `src/components/ui.tsx` (147 lines) | every shared visual primitive |
| `src/app/layout.tsx` | fonts, theme attribute |
| `src/app/(app)/layout.tsx` | shell: sidebar, header, main |
| `src/app/(app)/nav-links.tsx` | nav grouping and active-state language |
| `src/components/charts.tsx` | recharts theming |

That compactness is itself part of the design language: one card class, one
field class, two button classes, and everything else is Tailwind utilities
resolved through semantic tokens.

Status legend used throughout:

- **HAS** - Taxottic already has a working equivalent.
- **CONFLICT** - Taxottic has something that occupies the same slot but works differently.
- **NONE** - Taxottic has nothing in this slot.

---

## 1. Color tokens

### 1.1 The token vocabulary

Techottic defines exactly nine semantic color variables, once per theme, on
`:root` / `[data-theme="..."]` (`globals.css:5-34`):

| Variable | Dark (default) | Light |
| --- | --- | --- |
| `--background` | `#0a0a0b` | `#f6f6f7` |
| `--surface` | `#101012` | `#ffffff` |
| `--surface-2` | `#17171a` | `#f0f0f2` |
| `--border` | `#232327` | `#e2e2e6` |
| `--border-bright` | `#33333a` | `#cfcfd6` |
| `--foreground` | `#f4f4f5` | `#17171b` |
| `--muted` | `#9c9ca6` | `#5d5d68` |
| `--accent` | `#059669` | `#059669` |
| `--accent-2` | `#34d399` | `#10b981` |
| `--code-bg` | `rgba(0,0,0,0.32)` | `rgba(0,0,0,0.06)` |
| `--code-fg` | `#6ee7b7` | `#047857` |

Plus `color-scheme: dark` / `light` on the same selector, so native controls
(select popups, date pickers, scrollbars) follow the theme for free.

Two properties matter more than the hex values:

1. **`--accent` is identical in both themes.** Only the neutrals move. That is
   why the theme flip is a one-line change and never turns into per-component
   whack-a-mole.
2. **There are exactly two border tokens**, `--border` (resting) and
   `--border-bright` (hover / focus). Every hover state in the app is
   "raise the border one step", which is what gives the UI its consistent
   tactile feel.

### 1.2 Exposure to Tailwind

`globals.css:36-48` re-exports the tokens through Tailwind v4's `@theme inline`,
which is what makes `bg-surface`, `border-edge`, `text-muted`, `bg-accent`
work as ordinary utilities:

```css
@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-edge: var(--border);          /* note the rename: border -> edge */
  --color-edge-bright: var(--border-bright);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-accent: var(--accent);
  --color-accent-2: var(--accent-2);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

The `border` -> `edge` rename exists because `border-border` is unreadable;
`border-edge` / `border-edge-bright` is the actual utility used 112 times
across the app.

**Taxottic status: NONE.** Taxottic has brand ramps (`--color-forest-50..950`,
`--color-gold-50..900`, `--color-cream`, `--color-ink*`) but no semantic layer.
It has no `surface`, no `edge`, no `muted`, no `accent`. The absence is why
Taxottic's dark theme is implemented as roughly sixty
`html[data-theme="dark"] .text-forest-700 { color: ... !important }` override
rules in `app/globals.css` instead of a token swap. **This is the single
highest-value thing to port.**

### 1.3 Semantic status colors versus accent

Techottic keeps status color out of the token layer entirely and holds it in
TypeScript maps next to the component that renders it. `src/components/ui.tsx:36-45`:

```
New              #38bdf8   (sky)
Open             #e2e8f0   (slate-200)
In Progress      #fbbf24   (amber-400)
Pending Customer #f472b6   (pink-400)
On Hold          #94a3b8   (slate-400)
Escalated        #ef4444   (red-500)
Resolved         #34d399   (emerald-400)
Closed           #64748b   (slate-500)
```

Priority (`ui.tsx:60-62`): `P1 #ef4444`, `P2 #f97316`, `P3 #eab308`, `P4 #64748b`.
Health dots (`ui.tsx:88-94`): `online #34d399`, `degraded #fbbf24`, `offline #ef4444`.

The rendering formula is the reusable part, and it is used identically by
`StatusBadge`, `PriorityBadge` and `VipBadge`:

```
color:      c
background: c + "1a"   (10% alpha)
border:     1px solid c + "40"   (25% alpha)
```

One hue, three alphas. Every pill in the product is built that way, which is
why a screen full of differently-colored badges still reads as one system.

Banner severities are the only status colors in CSS (`globals.css:139-144`):

```
critical  bg rgba(239,68,68,.14)   fg #fca5a5   border rgba(239,68,68,.3)
warning   bg rgba(245,158,11,.14)  fg #fcd34d   border rgba(245,158,11,.3)
info      bg rgba(56,189,248,.14)  fg #7dd3fc   border rgba(56,189,248,.3)
```

with fully separate light-mode values (`#fee2e2/#991b1b`, `#fef3c7/#92400e`,
`#e0f2fe/#075985`) rather than alpha maths, because alpha-on-white washes out.

**Taxottic status: CONFLICT.** Taxottic uses Tailwind's palette classes
directly (`text-red-700`, `bg-emerald-50`, `border-amber-200`) and then patches
each one for dark mode with an `!important` override. Same intent, opposite
mechanism: Techottic computes the three alphas from one hue at render time and
needs no dark-mode override at all.

### 1.4 Ambient background

`globals.css:57-58` puts a single fixed accent wash behind everything:

```css
background-image: radial-gradient(900px 420px at 75% -12%, rgba(16,185,129,0.05), transparent 65%);
background-attachment: fixed;
```

5% alpha, top-right, fixed. Barely perceptible, but it stops the flat
near-black from reading as dead.

**Taxottic status: HAS (heavier).** Taxottic runs a two-stop gold and forest
wash at 16% and 6% via `body::before` with a `mask-image` fade. Same idea,
about 3x the intensity.

### 1.5 Selection and scrollbar

```css
::selection { background: rgba(16, 185, 129, 0.3); }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--muted) 35%, transparent);
  border-radius: 8px;
}
::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--muted) 55%, transparent);
}
```

The `color-mix` against `--muted` means the scrollbar re-tints itself on theme
flip with no second rule.

**Taxottic status: HAS.** 8px thumb, gold at 28% / 55% hover, with an explicit
second rule for dark. Functionally equivalent; Techottic's is one rule instead
of two because it derives from a token.

---

## 2. Typography

### 2.1 Typefaces

`src/app/layout.tsx:7-15` - two Google fonts via `next/font`, nothing else:

```ts
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
```

Applied as `font-family: var(--font-sans), system-ui, sans-serif` on `body`.
There is no display face and no serif: headings are the same Geist at a heavier
weight. Two per-user opt-outs exist (`globals.css:50-51`),
`html[data-font="system"]` and `html[data-font="serif"]`, driven by a platform
setting.

**Taxottic status: CONFLICT (deliberately not ported).** Taxottic runs Fraunces
(display serif) + Hanken Grotesk (body) + Conquera (wordmark only), loaded via
`next/font` in `app/layout.tsx`. That pairing is the brand and is mirrored in
the iOS watch app and Wear OS theme files. Swapping to Geist would be a brand
change, not a design-system port. See section 10.

### 2.2 Type scale actually in use

Counted across all `className` attributes in `src/`:

| Token | Uses | Role |
| --- | --- | --- |
| `text-xs` (12px) | 431 | the workhorse; table cells, metadata, most labels |
| `text-sm` (14px) | 212 | body copy, nav links, buttons, inputs |
| `text-[11px]` | 46 | dense secondary metadata, badges |
| `text-[10px]` | 67 | nav group headings, environment chips |
| `text-2xl` (24px) | 15 | page titles |
| `text-xl` (20px) | 10 | sidebar wordmark |
| `text-3xl` (30px) | - | stat-card values only |
| `text-[9px]` | 8 | micro annotations |

The distribution is the point. Techottic is a **12px-dominant** interface:
`text-xs` outnumbers `text-sm` two to one. Nothing above 24px appears outside
a stat value or the login splash.

**Taxottic status: CONFLICT.** Taxottic's shared `PageHeader` renders
`text-3xl sm:text-4xl` serif titles, and body copy sits at `text-sm`/`text-base`.
Taxottic is roughly one full step larger and more airy at every level.

### 2.3 Letter-spacing on labels

Three distinct label treatments, each used consistently:

```
Stat card label   text-xs  font-medium uppercase tracking-wider  text-muted
                  (ui.tsx:108)
Section title     text-sm  font-semibold uppercase tracking-wider text-muted
                  (ui.tsx:119)
Nav group heading text-[10px] font-bold uppercase tracking-[0.14em] text-muted/70
                  (nav-links.tsx:72)
```

The pattern: as the label gets smaller, the weight goes up and the tracking
goes up. All three are `--muted`, never accent-colored.

**Taxottic status: CONFLICT.** Taxottic's `.kicker` (10px, `0.32em`, gold-700)
and `.kicker-sm` (11px, `0.2em`, gold-700) occupy the same slot. Two
differences: Taxottic's tracking is much wider (`0.32em` versus `0.14em`), and
Taxottic's eyebrow is **accent-colored (gold)** where Techottic's is always
muted grey.

### 2.4 Heading treatment

`PageHeader` (`ui.tsx:125-137`) is the whole story:

```tsx
<h1 className="text-2xl font-bold tracking-tight">{title}</h1>
{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
```

24px, bold, **negative** tracking, with a 14px muted subtitle 4px below, inside
a `mb-6 flex flex-wrap items-end justify-between gap-3` row that right-aligns
an optional action. No eyebrow, no rule, no ornament.

The one exception is the wordmark, which uses a gradient clip
(`layout.tsx:34`, `login/page.tsx:21`):

```tsx
className="bg-gradient-to-r from-foreground to-emerald-500 bg-clip-text text-transparent"
```

**Taxottic status: CONFLICT.** Taxottic's `components/PageHeader.tsx` renders
eyebrow -> 30/36px serif title -> subtitle -> gold flourish ornament. Four
elements where Techottic has two, and roughly 1.5x the title size.

---

## 3. Spacing and layout

### 3.1 Shell geometry

From `src/app/(app)/layout.tsx`:

- Sidebar: `fixed inset-y-0 left-0 z-40 w-60` (240px), `border-r border-edge`,
  `bg-surface/80 backdrop-blur-xl`.
- Sidebar brand block: `px-5 py-5`. Nav: `px-3 py-4`. Footer: `p-3`.
- Content column: `ml-60`, i.e. exactly the rail width, no gutter.
- Header: `sticky top-0 z-30 ... px-6 py-3`, `border-b border-edge`,
  `bg-background/70 backdrop-blur-xl`.
- Main: `flex-1 p-6`. Flat 24px padding at every breakpoint.

No max-width cap on content anywhere. Content fills the canvas.

**Taxottic status: HAS (different numbers).** Rail is 224px expanded with
`main { padding-left: 15rem }` (240px) clearance on lg+, plus a fluid content
cap of `min(168rem, calc(100vw - 21rem))`. Taxottic's header is fixed with a
`--app-header-h` custom property tracking three breakpoints. Taxottic's shell is
substantially more complex because it also serves native WebViews with safe-area
insets.

### 3.2 Gap scale

| Class | Uses |
| --- | --- |
| `gap-2` (8px) | 155 |
| `gap-3` (12px) | 63 |
| `gap-1.5` (6px) | 45 |
| `gap-4` (16px) | 36 |
| `gap-1` (4px) | 25 |
| `gap-6` (24px) | 15 |

Tight: 8px is the default gap, and 24px only appears between top-level page
sections. Vertical nav rhythm is `space-y-5` between groups, `space-y-0.5`
between items inside a group (`nav-links.tsx:69,73`).

**Taxottic status: HAS.** Comparable, slightly looser.

### 3.3 Border radii

| Radius | Where |
| --- | --- |
| `14px` | `.card` (the only hardcoded radius in CSS, `globals.css:70`) |
| `rounded-xl` (12px) | nav rows, avatar container rows - 52 uses |
| `rounded-lg` (8px) | `.field`, `.btn-primary`, `.btn-ghost`, icon buttons - 43 uses |
| `rounded-md` (6px) | `PriorityBadge`, environment chip - 30 uses |
| `rounded-full` | `StatusBadge`, `VipBadge`, `Avatar`, dots - 46 uses |
| `rounded-2xl` (16px) | 14 uses, sidebar footer row and a few modals |
| `12px` | recharts tooltip, leaflet container |

The 14px card radius sits deliberately between `rounded-xl` and `rounded-2xl`
and is not expressible as a Tailwind default, which is why it is raw CSS.

**Taxottic status: CONFLICT.** Taxottic's `.card` is `1rem` (16px) and
`.surface` is `1.125rem` (18px). Both are rounder than Techottic's 14px.

### 3.4 Hairlines

Every separator in the app is `1px solid var(--border)`, expressed as
`border-edge`. Softer variants use alpha on the same token:
`border-edge/50`, `border-edge/40` on table rows.

There is one decorative rule, `.glow-line` (`globals.css:75-78`), a 1px
tapered line used under the sidebar wordmark:

```css
background: linear-gradient(90deg, transparent,
            color-mix(in srgb, var(--foreground) 14%, transparent), transparent);
height: 1px;
```

**Taxottic status: HAS (ornamented).** Taxottic's equivalents are `.gold-rule`
(56px tapered gold) and `.gold-flourish` (two tapered lines plus a rotated
diamond pip), both accent-colored. Techottic's is a neutral 14% foreground fade.

---

## 4. Elevation and surfaces

### 4.1 The card

`globals.css:67-73`, the entire card definition:

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
[data-theme="light"] .card { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); }
```

**One shadow stop, 2px blur, no spread, no offset beyond 1px.** Separation
comes from the border and from `--surface` being a different value than
`--background` (`#101012` on `#0a0a0b` in dark, `#ffffff` on `#f6f6f7` in
light). The shadow is a whisker, not a lift.

Hover, where a card is interactive, is `transition hover:border-edge-bright`
(`ui.tsx:107`) - the border brightens one step and nothing moves.

There is no second card class. `.card` is used for stat tiles, panels, tables,
empty states and modals alike.

**Taxottic status: CONFLICT.** Taxottic runs a two-stop shadow with a 34px
blur and -18px spread:

```css
box-shadow: 0 1px 2px rgba(18,26,42,.05), 0 14px 34px -18px rgba(18,26,42,.26);
```

and `.card-hover` / `.surface-hover` add `translateY(-1px)` plus a 50px-blur
shadow. Taxottic has two near-identical card classes (`.card`, 377 call sites;
`.surface`, 3 call sites). Techottic's treatment is roughly one-sixth the blur
and does not move on hover.

### 4.2 Panel separation

Panels are separated by their own borders, sitting on a slightly darker page.
Sidebar and header get `backdrop-blur-xl` over a semi-transparent surface
(`bg-surface/80`, `bg-background/70`) so scrolled content frosts behind them.
No dividers, no inset highlights, no gradient edges anywhere.

**Taxottic status: HAS.** `.app-header` uses `backdrop-filter: blur(14px)
saturate(140%)` over a 94-97% alpha forest gradient, plus a grain overlay
(`::before`) and an animated gold sweep (`::after`). Same frosting idea with
substantially more decoration.

---

## 5. Component patterns

### 5.1 Buttons

Exactly two classes (`globals.css:95-101`), both written with `@apply`:

```css
.btn-primary {
  @apply inline-flex items-center justify-center gap-2 rounded-lg
         bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm
         hover:bg-emerald-600 active:scale-[.99] transition
         cursor-pointer disabled:opacity-50;
}

.btn-ghost {
  @apply inline-flex items-center justify-center gap-2 rounded-lg
         border border-edge bg-transparent px-3 py-2 text-sm font-medium
         text-foreground hover:border-edge-bright hover:bg-surface-2
         active:scale-[.99] transition cursor-pointer;
}
```

Extracted rules:

- **Primary is the accent color**, filled, white text, `font-semibold`.
- **Ghost is transparent with a hairline**, foreground text, `font-medium`.
- Height comes from `py-2` plus `text-sm`, i.e. **36px**, not a fixed height.
- Padding asymmetry is intentional: primary `px-4`, ghost `px-3`.
- Both `rounded-lg` (8px), both `gap-2` for a leading icon.
- **Press feedback is `active:scale-[.99]` on both.** This is the single most
  characteristic interaction in the product.
- Hover: primary darkens fill; ghost raises border one step and fills to
  `surface-2`. Never a transform.
- Disabled: `disabled:opacity-50` on primary only.

Icon-only buttons are not a class; they are written inline as
`rounded-lg border border-edge bg-surface-2/60 p-2.5 text-muted transition
hover:border-edge-bright hover:text-foreground cursor-pointer`
(`theme-toggle.tsx:36`).

**Taxottic status: CONFLICT.** Taxottic's `.btn-primary` is a navy vertical
gradient with an inset gold highlight, `height: 2.75rem` (44px, fixed),
`padding: 0 1.25rem`, `border-radius: 0.625rem` (10px), `font-weight: 500`, and
hover is `translateY(-1px)` plus a 18px-blur shadow. So: 44px versus 36px, a
gradient versus a flat accent fill, lift-on-hover versus darken-on-hover, and
no `active:` press state at all. Taxottic's `.btn-ghost` is closer but also
44px and also lifts on hover.

### 5.2 Inputs

One class (`globals.css:91-93`):

```css
.field {
  @apply w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm
         text-foreground placeholder:text-muted/60 outline-none
         focus:border-edge-bright focus:ring-2 focus:ring-accent/25 transition;
}
```

Key choices: the field background is `--surface-2`, i.e. **recessed relative to
the card** it sits in, not white. Focus is a two-part signal, border steps to
`edge-bright` **and** a 2px accent ring at 25% alpha. Placeholder is
`muted/60`.

Native control theming is handled centrally (`globals.css:81-87`):

```css
input, select, textarea { color-scheme: inherit; }
option { background: var(--surface-2); color: var(--foreground); }
input:-webkit-autofill { -webkit-text-fill-color: var(--foreground);
  -webkit-box-shadow: 0 0 0 1000px var(--surface-2) inset;
  transition: background-color 9999s ease-in-out 0s; }
```

The `9999s` transition is the standard trick to defeat Chrome's autofill
background.

**Taxottic status: CONFLICT.** Taxottic's `.input` is 44px fixed height, white
(elevated, not recessed) on light, `0.625rem` radius, `font-size: 1rem` below
640px to defeat the iOS zoom-on-focus, and focus is a 3px forest shadow with no
ring token. Taxottic also has a global `:focus-visible` gold outline
(`2px solid rgba(196,162,93,.85)`, `outline-offset: 2px`) which Techottic
does not have.

Taxottic's iOS 16px rule and its custom `select` chevron (a data-URI stroke SVG
with a light and a dark variant) are **better than Techottic's** and must not be
regressed.

### 5.3 Cards, stats, sections, empty states

All four live in `src/components/ui.tsx`:

**StatCard** (`ui.tsx:103-114`):

```tsx
<div className="card p-4 h-full transition hover:border-edge-bright">
  <div className="text-xs font-medium uppercase tracking-wider text-muted">{label}</div>
  <div className="mt-1 text-3xl font-bold" style={{ color: accent }}>{value}</div>
  {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
</div>
```

Default accent `#10b981`, wraps in a `<Link>` when `href` is passed. The
signature is small-caps muted label -> very large colored number -> small muted
sub. 12px, 30px, 12px.

**SectionTitle** (`ui.tsx:116-123`): `mb-3 flex items-center justify-between`
with an uppercase muted `h2` and an optional right-aligned action node.

**EmptyState** (`ui.tsx:139-147`):

```tsx
<div className="card flex flex-col items-center justify-center gap-2 p-10 text-center">
  <div className="text-muted/60">{icon}</div>
  <div className="font-medium">{title}</div>
  {sub && <div className="text-sm text-muted">{sub}</div>}
</div>
```

A card, 40px padding, icon at `muted/60`, medium title, small muted sub.

**Taxottic status: NONE for all four.** Taxottic has `components/PageHeader.tsx`
and nothing else shared. Stat tiles, section headings and empty states are
hand-rolled per page.

### 5.4 Badges, pills, chips

Covered by the formula in section 1.3. The markup:

```tsx
// StatusBadge - ui.tsx:47-58
className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs
           font-medium whitespace-nowrap"
style={{ color: c, background: `${c}1a`, border: `1px solid ${c}40` }}
// with a leading 6px dot: <span className="h-1.5 w-1.5 rounded-full" style={{background: c}} />

// PriorityBadge - ui.tsx:64-74
className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px]
           font-bold tracking-wide"
```

So: **pills are `rounded-full` with a leading dot; codes are `rounded-md`
with no dot and heavier weight.** Both `py-0.5`.

The environment chip (`(app)/layout.tsx:36-43`) shows the same shape done with
Tailwind classes instead of inline style:
`rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-widest` with
`bg-emerald-500/15 text-emerald-400 border border-emerald-500/30` - note
15%/30%, the same alpha pair as `1a`/`40`.

**Taxottic status: CONFLICT.** Taxottic writes badges inline per call site using
Tailwind palette classes plus a dark-mode `!important` override per class. Same
look, no shared primitive, and the dark variants must be hand-maintained.

### 5.5 Tables

There is no table component. The pattern is written out and is consistent
(counted across `src/`):

```
<table className="w-full text-sm">                                  x9
<thead> tr:  "border-b border-edge text-left text-xs uppercase
              tracking-wider text-muted"                            x5
        (dense variant uses text-[10px])                            x4
<tbody> tr:  "border-b border-edge/50 transition hover:bg-surface-2/40"
<td>:        "px-4 py-3"                                            x33
             "px-4 py-3 text-xs text-muted"  for secondary columns  x4
             "px-3 py-2.5"  for the dense variant                   x4
```

So: 14px table, 12px uppercase tracked muted header on a full hairline,
half-alpha row hairlines, `surface-2` at 40% on row hover, 16x12px cells.

**Taxottic status: NONE.** No shared table treatment; each page writes its own.

### 5.6 Sidebar and nav

`(app)/nav-links.tsx:68-98`. Groups render as:

```tsx
<div className="space-y-5">                                   // between groups
  <div className="px-2 pb-1.5 text-[10px] font-bold uppercase
                  tracking-[0.14em] text-muted/70">{group}</div>
  <div className="space-y-0.5">                               // between items
    <Link className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition
      + active
        ? 'bg-accent/15 font-semibold text-emerald-300 border border-accent/30'
        : 'text-muted hover:bg-surface-2 hover:text-foreground border border-transparent'
    ">
```

The active-state formula is the important part and it is the same three-alpha
formula as the badges:

```
background: accent at 15%
border:     1px accent at 30%
text:       accent-light (emerald-300)
weight:     semibold
```

Idle rows carry `border border-transparent` so the row does not shift by 1px
when it becomes active. Icons are 16px lucide, `gap-2.5` from the label.

**Taxottic status: CONFLICT.** Taxottic's `LeftRail` active state is
`bg-cream text-forest-900 ring-1 ring-gold-300/70 font-medium` on light. Same
intent (tinted background plus accent ring), implemented with a solid cream fill
and a `ring` rather than an alpha accent fill and a `border`. Taxottic's rows are
`rounded-xl px-3 py-2.5 gap-3`, marginally larger than Techottic's
`rounded-xl px-2.5 py-2 gap-2.5`.

### 5.7 Headers

App header (`(app)/layout.tsx:86-92`): `sticky top-0 z-30 flex items-center
justify-between gap-3 border-b border-edge bg-background/70 px-6 py-3
backdrop-blur-xl`. Contains the command palette on the left and theme toggle
plus notification bell on the right. Nothing else.

**Taxottic status: HAS.** `AppHeader` plus `.app-header`, considerably more
elaborate (gradient, grain, animated gold sweep, mobile scroll-shrink).

### 5.8 Toasts and banners

Techottic has no toast system. Notifications are a bell dropdown; transient
messaging is done with the page-level banner strip in
`(app)/layout.tsx:76-85`, styled by `.notice-critical` / `.notice-warning` /
`.notice-info` (section 1.3) at `px-6 py-2 text-sm font-medium`.

**Taxottic status: HAS.** Taxottic has several banner components
(`TrialBanner`, `OutdatedAppBanner`, `TrackingHealthBanner`, `GdprBanner`) with
per-component styling and no shared severity class.

---

## 6. Motion

Complete inventory. Techottic's motion vocabulary is deliberately tiny:

| Where | Value |
| --- | --- |
| Everything interactive | Tailwind's bare `transition` = `150ms cubic-bezier(0.4, 0, 0.2, 1)` on color, background, border, opacity, transform, filter |
| Button press | `active:scale-[.99]` |
| Card hover | border color only, no transform |
| Escalated / offline dot | `.pulse-red`, `pulse-dot 1.6s infinite` - an expanding `box-shadow` ring from `rgba(239,68,68,.45)` spread 0 to `rgba(239,68,68,0)` spread 6px |
| Autofill defeat | `transition: background-color 9999s` |

That is the entire list. **No page-load animation, no reveal sequence, no
stagger, no skeleton shimmer, no easing curve other than Tailwind's default.**

**Taxottic status: CONFLICT (much heavier).** Taxottic runs `co-gold-pan` 8s,
`co-header-shimmer` 12-14s, `bella-spin` 6s, `reward-drift` 16s,
`slideUpFromCorner`, `fadeIn`, plus `translateY(-1px)` lifts on cards and both
button classes, and 0.15s/0.2s explicit `ease` durations. Taxottic does have a
global `prefers-reduced-motion` kill switch, which Techottic lacks - that is
strictly better and must be kept.

---

## 7. Icons

- Library: **`lucide-react` ^1.27.0**, the only UI dependency in
  `package.json` besides recharts and leaflet.
- Size: **`size={16}`** on every nav item (`nav-links.tsx:22-63`), every
  toolbar icon (`theme-toggle.tsx:38`), and every table action
  (`ticket-table.tsx`). 16px is effectively the only icon size.
- Stroke: lucide's default, `strokeWidth={2}` at a 24px viewBox.
- Color: icons inherit `currentColor` from the row, so they follow the
  `text-muted` -> `text-foreground` hover transition with the label.
- Gap to label: `gap-2.5` in nav, `gap-2` in buttons.

Non-lucide glyphs do exist and are emoji: `⚡` in the wordmark, `⏻` for sign
out, `🚨 ⚠️ ℹ️` on banners, `★` on the VIP badge. **These are not ported** -
see section 10.

**Taxottic status: HAS (different mechanism, equivalent quality).** Taxottic has
no icon dependency; it hand-rolls stroke SVGs through local `Icon`/`Path`
helpers (`LeftRail.tsx:96-119`) at `viewBox="0 0 24 24"`, `fill="none"`,
`stroke="currentColor"`, `strokeWidth={1.6}`, rendered at `size-5` (20px).

Two real differences: Taxottic's stroke is **1.6 versus lucide's 2**, and
Taxottic renders at **20px versus 16px**. Taxottic's icons are therefore
slightly larger and slightly lighter. Adding lucide is not worth a dependency
and the existing helpers already satisfy the "clean stroke SVGs, never emoji"
rule.

---

## 8. Charts

`src/components/charts.tsx`. Recharts, four exported chart types, one shared
tooltip style.

```ts
const TT_STYLE = {
  contentStyle: { background: "#17171a", border: "1px solid #33333a",
                  borderRadius: 12, fontSize: 12, color: "#f4f4f5" },
  labelStyle: { color: "#9c9ca6" },
  cursor: { fill: "rgba(16,185,129,0.06)" },
};
```

Axis and grid conventions, applied identically in all charts:

```
tick={{ fill: "var(--muted)", fontSize: 11 }}
axisLine={false}
tickLine={false}
<CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
```

So: **no axis lines, no tick lines, horizontal-only dashed grid at
`--border`, 11px muted tick labels.**

Area fills are always a vertical `linearGradient` from `stopOpacity={0.4}` (or
`0.35`) to `0`, with `strokeWidth={2}` on the line. Bars are
`radius={[0,8,8,0]}` at `barSize={16}` for horizontal bars. Pies are donuts:
`innerRadius="52%" outerRadius="82%" paddingAngle={2} strokeWidth={0}`.

Categorical palettes:

```
bars:  #10b981  #6ee7b7  var(--foreground)  #34d399  #a7f3d0  #fbbf24  #94a3b8  #f472b6
pies:  #10b981  #38bdf8  #a855f7  #fbbf24  #f472b6  #94a3b8  #f97316  #34d399  #ef4444  #6ee7b7
```

Note the tooltip is **hardcoded dark** while ticks and grid use tokens. That is
a real inconsistency in Techottic: its tooltip does not follow the light theme.

**Taxottic status: NONE (no chart library).** Taxottic draws charts as raw
inline SVG. Critically, **raw SVG `fill`/`stroke`/`text` hex is not remapped by
Taxottic's `data-theme` overrides**, so any SVG on an authenticated (dark) page
must use light hex values or it renders invisible. Techottic's
`fill: "var(--muted)"` approach would work in Taxottic too and would be the
correct fix, but it is a behavior change to charts and out of scope here. The
existing light-hex convention must not be regressed.

---

## 9. What to port, ranked by leverage

1. **The semantic token layer** (section 1.1-1.2). Highest leverage by a wide
   margin. It replaces roughly sixty `!important` dark-mode overrides with a
   token swap and gives every future component a theme-safe vocabulary.
2. **Card treatment** (section 4.1). `.card` has 377 call sites in Taxottic;
   retuning it to Techottic's 14px radius and one-stop 2px shadow changes the
   feel of the whole product in one edit.
3. **Button and input states** (5.1-5.2). Press feedback, hover-brightens-border,
   accent focus ring.
4. **The three-alpha formula** (1.3) as a real shared primitive, so badges stop
   being hand-written and stop needing dark-mode overrides.
5. **Missing primitives** (5.3): StatCard, SectionTitle, EmptyState.
6. **Nav active state** (5.6): alpha accent fill plus accent border, with
   transparent borders on idle rows so nothing shifts.
7. **Page header proportions** (2.4): 24px bold tracking-tight over a muted
   subtitle, ornament removed.
8. **Table treatment** (5.5) as shared classes.
9. **Density pass** (2.2): move page bodies toward 12px-dominant.

---

## 10. Deliberately not ported

| Item | Reason |
| --- | --- |
| Emerald `--accent: #059669` | Taxottic's accent is champagne gold `#c4a25d` / `#d5bb7e`, mirrored in `ios/TaxotticWatch/Theme.swift` and `wear/.../Theme.kt` and in shipped App Store assets. Porting the hue would break brand consistency across three platforms. The token *slot* is ported; the value stays gold. |
| Geist / Geist Mono | Taxottic's Fraunces + Hanken Grotesk + Conquera pairing is the brand identity, not a design-system detail. |
| `⚡` wordmark glyph, `⏻` sign-out, `🚨 ⚠️ ℹ️` banners, `★ VIP` | Emoji in UI chrome. Violates the project rule; these products are sold to corporate clients. |
| Leaflet skin (`globals.css:103-122`) | Taxottic uses Google Maps, not Leaflet. |
| Light theme as the authenticated default | Taxottic's authenticated app is dark by design (`DarkThemeMount`). |
| `lucide-react` | Taxottic already has equivalent hand-rolled stroke SVG helpers. Not worth a dependency. |
| Hardcoded dark recharts tooltip | It is a bug in Techottic (does not follow the light theme), not a pattern. |
| No `prefers-reduced-motion` guard | Techottic lacks one. Taxottic's global guard is strictly better and is kept. |
| Fixed 16px `.input` font-size and the custom `select` chevron | Techottic has neither. Taxottic's versions defeat iOS zoom-on-focus and the Android WebView black-dropdown bug. Kept. |

---

## 11. What was applied (Phase 2, July 2026)

Token layer and shared primitives only. Individual page bodies were not
touched; they inherit the change through `.card`, `.input`, `.btn-*`,
`PageHeader` and `LeftRail`.

**`app/globals.css`**

- Added the semantic token block (`--background`, `--surface`, `--surface-2`,
  `--border`, `--border-bright`, `--foreground`, `--muted`, `--accent`,
  `--accent-2`, `--accent-fg`, `--kicker`) for light and dark, exported
  through `@theme inline` as `bg-surface`, `border-edge`, `text-muted`,
  `bg-accent` and friends.
- `.card` / `.surface`: rebuilt on the tokens; radius 1rem/1.125rem -> 14px;
  two-stop 34px-blur shadow -> one 2px stop; hover lift removed in favour of
  "border brightens one step". `.surface` is now an alias of `.card`.
- `.btn-primary`: navy gradient with inset gold highlight -> flat `--accent`
  fill; hover lift -> `filter: brightness(.92)`; added `active: scale(.99)`.
- `.btn-ghost`: hover lift removed, hover fills to `--surface-2`, added
  `active: scale(.99)` and a disabled state.
- `.input`: background moved from white to the recessed `--surface-2`; focus
  is now border-step plus a 2px accent ring at 25%.
- Added `.icon-btn`, `.stat-label`, `.stat-value`, `.section-title`,
  `.nav-group-title`, `.glow-line`, `.pill`, `.pill-code`, `.pill-dot`,
  `.data-table`, `.row-hover`.
- Removed the now-redundant `html[data-theme="dark"]` twins for `.card`,
  `.card-hover`, `.input` and `.btn-ghost`. The token swap supplies them.
- `.kicker` / `.kicker-sm` moved off the fixed `gold-700` onto the new
  `--kicker` token, which fixes a pre-existing contrast bug: the eyebrow was
  `#8a661f` on `#121a2a` on every dark page.

**`components/ui/Primitives.tsx`** (new)

`StatCard`, `SectionTitle`, `EmptyState`, `StatusPill`, `CodePill`, and the
`PILL_TONES` map. Server components; all colour goes through `currentColor`
or a custom property, never literal SVG hex.

**`components/PageHeader.tsx`**

Title 3xl/4xl -> 2xl/3xl, `flourish` default true -> false, colours moved to
`text-foreground` / `text-muted`, new optional `action` slot on the title
baseline.

**`components/LeftRail.tsx`**

Active row `bg-cream + ring-gold-300/70` -> `bg-accent/15 + border-accent/40 +
text-foreground + font-semibold`, with `border-transparent` on idle rows so
nothing shifts. Idle rows now `text-muted` -> `text-foreground` on hover.
Rail container -> `bg-surface/80 backdrop-blur-xl` with a plain
`border-edge` hairline (drop shadow removed). Group headings ->
`.nav-group-title`. Company-list separator -> `.glow-line`.

**`public/sw.js`** `CACHE_VERSION` v130 -> v131.

### Not yet done

Sections 5.5 (tables), 5.8 (banner severities) and 9.9 (the 12px density
pass) are specified above but not applied. The `.data-table` and `.pill`
classes exist; no page has been migrated onto them yet, and the ~60
`html[data-theme="dark"] .text-* { !important }` overrides still stand
because hundreds of pages still write brand classes directly. They can be
retired incrementally as pages move onto the semantic tokens.

The Playwright visual baselines in `e2e/visual.spec.ts-snapshots/` and
`__ct-snapshots__/` predate these changes and will need regenerating
(`npm run e2e:visual:update`, `npm run test:ct:update`).
