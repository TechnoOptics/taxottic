# Mileage tracker — single-pass spec

Build it once, correctly (same discipline that finally landed
native OAuth). Phase 1 (this PR) ships the **fully-tested core**;
later phases are sequenced and each independently verifiable.

## Product vision (from the business)

- The phone auto-detects driving and lays down a **breadcrumb
  trail** per day/week.
- A trip is **vehicular movement** (faster than a person can
  sustainably run) that **ends after ≥5 min stationary** in one
  spot. (Implemented — `lib/mileage/segmentation.ts`.)
- Trails are **colour-coded**: work vs personal.
- **Markers** for home / office / client / other key stations.
- An **employee dashboard** (their own trails, day/week) and an
  **account-manager map** (team members' mileage trails).
- Once a trip is classified **business**, the **IRS standard
  mileage deduction** is applied. (Implemented —
  `lib/mileage/deduction.ts`, uses existing
  `MILEAGE_RATE_*_PER_MILE_CENTS`.)

## Architecture — why this split

| Layer | Verifiable without a device? | Phase |
|---|---|---|
| Trip segmentation + classification heuristic | ✅ pure, unit-tested | **1 (done)** |
| Mileage → IRS deduction | ✅ pure, unit-tested | **1 (done)** |
| Data model (trips/points/places) + RLS | ✅ migration, reviewable | 2 |
| Ingestion API (`POST /api/mileage/ingest`) | ✅ runs in CI | 2 |
| Forecast integration (Schedule C car/truck) | ✅ unit-tested | 2 |
| Google Maps dashboards (employee + manager) | ✅ renders in browser **and** WebView | 3 |
| Native background-geolocation capture | ❌ **needs a device build + plugin validation** | 4 |

The device only streams raw points to the ingestion endpoint;
**all intelligence is server/web**, so the hard parts are proven
in CI, not on a phone.

## Phase 2 — data model + ingestion

`supabase/migrations/<ts>_mileage_tracker.sql`:

- `mileage_places(id, company_id, created_by, kind
  enum('home','office','client','other'), label, lat, lng,
  radius_m default 120, created_at)`
- `mileage_trips(id, company_id, driver_user_id, started_at,
  ended_at, distance_miles numeric, classification
  enum('business','personal','unclassified') default
  'unclassified', classified_by, classified_at, start_place_id,
  end_place_id, tax_year int, deduction_cents bigint, notes,
  created_at)`
- `mileage_points(id, trip_id, captured_at, lat, lng, speed_mps,
  accuracy_m)` — the breadcrumb; index `(trip_id, captured_at)`
- **RLS:** driver full access where `driver_user_id = auth.uid()`;
  company managers read via the existing
  `firm_has_active_engagement_with(company_id)` / company-member
  manager role; `is_super_admin()` read. Add `mileage_trips` to
  `supabase_realtime` so the manager map live-updates.

`POST /api/mileage/ingest` — authed; body
`{ companyId, points: GpsPoint[] }`. Buffers points, runs
`segmentTrips`, upserts trips + points, sets
`classification = suggestClassification(...)` (driver/manager can
override), writes `deduction_cents` via `tripDeductionCents`.
Idempotent on `(driver, point timestamp)`.

Forecast: add a "mileage" contributor that pulls
`summarizeMileageDeduction(businessTrips, taxYear)` into the
Schedule C car/truck line (Form 1040 Sch C Line 9) and the
deduction stack. Standard-mileage method is assumed and is
mutually exclusive with actual-vehicle-expense — surface that as
an assumption string like the engine does elsewhere.

## Phase 3 — Google Maps dashboards

- **Key handling (security):** the Maps JS key goes in
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Vercel env), **HTTP-referrer
  restricted** to `taxottic.com` + the Capacitor WebView origin,
  and API-restricted to Maps JavaScript API. **Never commit the
  key**; never paste it in chat. A separate server key (if needed
  for Distance Matrix/Snap-to-Roads) stays server-only.
- **Employee view** (`/mileage` or under the company surface):
  day/week switcher; polylines per trip; **business = one colour,
  personal = another, unclassified = muted**; tap a trip to
  confirm/flip its classification; place markers (home/office/
  client/other) with distinct pins; running business-miles +
  deduction total for the period.
- **Account-manager view** (firm cockpit, e.g.
  `/firm/clients/[id]/mileage` or `/firm/mileage`): same map,
  scoped by RLS to engaged companies' drivers; filter by team
  member + date; per-driver mileage + deduction rollup.
- Renders identically in the browser and the Capacitor WebView —
  no native code, so no device needed to verify Phase 3.

## Phase 4 — native background capture (needs a build)

The ONLY device-dependent piece. Streams points to
`/api/mileage/ingest`.

- **Plugin:** validate Capacitor-8 compatibility *before*
  committing (the `@codetrix-studio/capacitor-google-auth` lesson
  — it peered Cap 6 and wasted a cycle). Candidates:
  `@capacitor-community/background-geolocation` or the commercial
  `@transistorsoft/capacitor-background-geolocation` (most
  robust, paid). `@capacitor/geolocation` alone is
  **foreground-only** — insufficient for "detects when the phone
  moved" with the app backgrounded.
- **iOS:** `NSLocationWhenInUseUsageDescription` +
  `NSLocationAlwaysAndWhenInUseUsageDescription`,
  `UIBackgroundModes: location`, the Location capability. App
  Review scrutinises Always-location — the usage strings must
  state the mileage-deduction purpose plainly.
- **Android:** `ACCESS_FINE_LOCATION` +
  `ACCESS_BACKGROUND_LOCATION` + a foreground service with a
  persistent notification (OS requirement).
- **Battery/privacy:** distance-filter + significant-change /
  motion-activity gating so we sample only while driving; an
  in-app toggle to pause tracking; clear disclosure in
  `/legal/privacy`.
- Requires a new TestFlight/Play build + on-device verification.

## Phase plan

1. ✅ **This PR:** `lib/mileage/segmentation.ts` (+tests),
   `lib/mileage/deduction.ts` (+tests), this spec. No device, no
   DB — pure logic the rest builds on.
2. Migration + ingestion API + forecast integration.
3. Google Maps employee + account-manager dashboards.
4. Native background capture (build + device).

Each phase is independently shippable and (1–3) independently
verifiable in CI/browser. Only phase 4 needs a device.
