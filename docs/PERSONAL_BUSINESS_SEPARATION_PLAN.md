# Plan: Separate Personal vs Business tax, with an opt-in "Combine"

Draft for review. Nothing built yet. This plans the change the user asked
for: personal and business should be independently configurable and
forecastable (separate profiles, forecasts, reporting, and advice), joined
only if the user opts in, and the personal dashboard should stop showing
the business overview.

## 1. Current state (what actually couples them today)

- **`tax_profiles`** is ONE row per user (filing status, state, age,
  dependents, itemize, etc.). It is read by BOTH:
  - the personal forecast (`app/personal/forecast`, `lib/tax/personal-forecast-input.ts`), and
  - the business/company forecast (`app/c/[publicId]/forecast` + `/breakdown`).
  So changing your personal filing status or state silently moves the
  business forecast too. This is the "personal tax profile affects business
  tax profile" report.
- **`business_profiles`** is per-company / per-year business config
  (entity, business-side settings). It exists but does not fully own the
  business tax picture; the personal profile still drives the individual-tax
  layer applied to business income.
- **Dashboard** (`app/dashboard/page.tsx`) is a single mixed hub: it renders
  a "Your business" readiness ring and the company card even when the user is
  in a personal headspace. There is no distinct personal dashboard, so
  "personal shows Technooptics business overview" is accurate.
- **Forecasts** already have two entry points (personal vs company) and the
  math core `buildCompanyForecast()` is a pure function, so a
  combined/separate calc is a matter of what inputs we feed it, not a rewrite.
- **Reporting/export** is partly split (`app/personal/export` vs the company
  reports) but advice (`lib/tax/year-end-suggestions.ts`) is not context-scoped.

## 2. The tax reality that constrains the design (important)

For pass-through entities (sole prop, single-member LLC, partnership, S-corp),
business net income flows onto the owner's personal 1040 and is taxed at
personal, progressive rates. So a business forecast CANNOT produce an accurate
total tax number without the personal context. That means:

- "Separate" can always give each side its own **config** and its own **P&L /
  cash-flow view**.
- But the **accurate total tax** for a pass-through only exists when business
  net is combined into personal. A standalone business tax number is an
  estimate with a stated assumption.
- For a **C-corp**, business tax IS genuinely separate (entity-level), so full
  separation is correct there.

The "Combine" toggle should therefore mean "roll business net into the personal
1040 for the accurate total," and its sensible DEFAULT is driven by entity type
(pass-through → combined on; C-corp → separate).

## 3. Target design

### 3a. Two independent configs
- Personal tax config stays in `tax_profiles` (individual: filing status,
  state, dependents, itemize...).
- Business tax config moves fully into `business_profiles` and becomes
  self-contained: entity type, business state/nexus, accounting method, and
  any business-only assumptions. The business forecast reads ONLY
  `business_profiles` for its own layer, never `tax_profiles`, unless combine
  is on.

### 3b. A per-user "Combine" preference (Settings)
- New boolean (see migration) `combine_personal_business` on the user's
  profile/settings, default derived from the primary company's entity type.
- Surfaced in **Settings** as: "Combine my business into my personal tax
  forecast" with a one-line explainer of the pass-through reasoning.
- When ON: business net (from each company the user owns) flows into the
  personal forecast input; personal forecast shows the accurate combined total.
- When OFF: personal and business forecasts are fully independent; the business
  forecast shows a standalone estimate with a visible "assumes a X% marginal
  rate / not combined with personal" caveat.

### 3c. Separate dashboards (fixes the "personal shows business" bug)
- `/dashboard` becomes the PERSONAL hub: personal readiness, personal
  forecast snapshot, personal next actions. It lists companies as a way to
  ENTER them, but does not render business readiness as if it were the user's.
- Each company keeps its own hub at `/c/[publicId]` (business readiness, P&L,
  company forecast).
- If combine is ON, the personal dashboard may show a small "incl. business"
  line, clearly labeled, rather than replacing personal with business.

### 3d. Separate forecasting
- Personal forecast: personal income + personal deductions + `tax_profiles`
  (+ business net only if combine ON).
- Business forecast: business P&L + `business_profiles` config, standalone.
- Reuse `buildCompanyForecast()` / `buildPersonalForecastInput()` unchanged;
  only the input assembly branches on the combine flag.

### 3e. Separate reporting & advice
- Personal export/report uses only personal data + personal profile.
- Company report uses only that company's data + business config.
- `year-end-suggestions` takes a context arg (`personal` | `business:<id>`)
  and only emits advice relevant to that context (e.g., SEP-IRA/QBI on
  business; IRA/HSA/itemize on personal).

## 4. Data model / migration

Single small migration:
- `profiles.combine_personal_business boolean not null default true`
  (default true = today's behavior, so nothing changes for existing users
  until they opt out; we can instead default from entity type at read time).
- Confirm `business_profiles` has the columns needed to be self-contained
  (entity_type, state, method). Add any missing business-config columns here
  rather than reusing `tax_profiles`.
- No destructive changes; `tax_profiles` stays as the personal profile.

## 5. Phased rollout (keeps each PR reviewable)

- **Phase 1 (foundation):** migration + make the business forecast read
  `business_profiles` for its own layer; add the combine flag read/write; no
  UI split yet (behavior identical when combine defaults preserve today's math).
- **Phase 2 (dashboards):** split `/dashboard` into a true personal hub;
  company hubs stay business-only. Fixes the "#6" bleed.
- **Phase 3 (settings + toggle):** the Combine toggle in Settings, with the
  entity-type-aware default and the standalone-estimate caveat when off.
- **Phase 4 (reporting + advice):** context-scope exports and
  year-end-suggestions.

## 6. Decisions (LOCKED 2026-07-06)

1. **v1 scope:** ship **Phase 1 + 2 first** (independent personal/business
   configs + split dashboards, which fixes the "personal shows business"
   bleed). Phase 3 (Combine toggle) and Phase 4 (scoped reporting/advice) are
   a fast follow.
2. **Combine toggle default:** **entity-type aware** - pass-through (sole
   prop / single-member LLC / S-corp / partnership) defaults to combined
   (tax-correct); C-corp defaults to separate.
3. **Standalone business (Combine OFF):** show **P&L + SE tax accurately, plus
   an income-tax estimate clearly labeled** "assumes ~X% marginal rate, not
   combined with personal."
4. **Multiple companies (open, low-priority):** default to rolling ALL owned
   companies' net into personal when combined; a per-company include toggle
   is a later refinement.

## 7. Phase 1 + 2 implementation checklist (the agreed v1)

Phase 1 (foundation, no visible behavior change if defaults preserve math):
- [ ] Migration: `profiles.combine_personal_business boolean` (default derived
      from entity type at read time; see decision 2).
- [ ] Ensure `business_profiles` is self-contained (entity_type, state,
      method); add any missing business-config columns there.
- [ ] Business forecast (`app/c/[publicId]/forecast` + `/breakdown`) reads its
      own layer from `business_profiles`, NOT `tax_profiles`, unless combine is
      on. Reuse `buildCompanyForecast()`; only the input assembly branches.
- [ ] Personal forecast unchanged except it only folds in business net when
      combine is on.

Phase 2 (dashboards):
- [ ] `/dashboard` becomes the personal hub: personal readiness + personal
      forecast snapshot + personal next actions; companies listed only as an
      entry point, not rendered as the user's own readiness.
- [ ] Company hub at `/c/[publicId]` stays business-only.
- [ ] When combine is on, personal dashboard may show a small, clearly
      labeled "incl. business" line rather than replacing personal with
      business.
