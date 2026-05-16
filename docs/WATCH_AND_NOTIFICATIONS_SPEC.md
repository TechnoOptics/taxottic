# Watch & actionable notifications — single-pass spec

## Product vision (from the business)

A wrist + lock-screen experience that keeps the user in the loop
without opening the app:

- Notify when an **expense has been applied** to the books.
- After a **trip**, ask "business or personal?" — answer in one
  gesture (swipe/tap), no app open.
- When a **meal or anything we're not sure about** could be
  business, prompt for a one-tap clarification.
- Alert when a **goal is met**, a **badge is awarded**, and when a
  **team member or tax preparer sends a message**.

## The reframe (read this first)

Almost none of this needs a watch *app*. ~90% is **notifications**,
and a paired Apple Watch / Wear OS watch shows phone notifications —
including actionable buttons — automatically, with **zero watch
code**. The interactive "Business / Personal" and "clarify this"
prompts are **actionable notifications** (notification action
categories), not a bespoke watch UI.

So the real dependency is a working **push-delivery pipeline**, which
**does not exist yet**:

- `components/CapacitorNativeInit.tsx` requests permission and calls
  `PushNotifications.register()` — but there is **no `registration`
  listener, no device-token storage, no APNs/FCM credentials, and no
  service that sends anything**. The token is dropped on the floor.

A dedicated watch app before push works would be building the roof
before the foundation.

## The hard constraint

Taxottic is a Capacitor **remote-WebView shell** (`server.url:
https://taxottic.com`). Capacitor has **no watchOS / Wear OS
support**. A true standalone watch app is a *separate native
project* — its own Xcode/Gradle targets, signing, and App
Store/Play submission, and watchOS development needs a Mac (the
project has deliberately avoided requiring one). It cannot be
web/CI-verified. That is Phase 4 and is explicitly optional.

## Architecture — what is verifiable without a device

| Layer | Verifiable without a device? | Phase |
|---|---|---|
| `device_tokens` table + RLS | ✅ migration, reviewable | 1 |
| Token capture (`registration` listener) | ⚠️ code reviewable; delivery needs a device | 1 |
| Push send service (provider behind an interface) | ✅ unit-tested with a fake provider | 1 |
| Pure payload builders (title/body/category/data per event) | ✅ unit-tested | 1 |
| Notification action categories (native registration) | ❌ needs a device build | 2 |
| Action-handler endpoints (Business/Personal, clarify) | ✅ runs in CI (HTTP, reuses existing auth) | 2 |
| Event wiring (trip/expense/goal/badge/message → enqueue) | ✅ unit-tested at the call sites | 3 |
| Preferences + de-dup + quiet hours | ✅ unit-tested | 3 |
| Dedicated watchOS / Wear OS app | ❌ separate native project, no CI path | 4 |

Same discipline as the mileage + OAuth specs: prove the hard parts
in CI; the only device-dependent pieces are the OS-level delivery
and (optionally) a watch target.

## Phase 1 — push delivery backend (the prerequisite)

**Data model** — `supabase/migrations/<ts>_push_tokens.sql`:

- `device_tokens(id, user_id, platform enum('ios','android','web'),
  token text, created_at, last_seen_at, revoked_at)`, unique on
  `(user_id, token)`. RLS: a user reads/writes only their own rows;
  the service role (server send path) reads all. Mirror the
  validate-session → service-write pattern used everywhere else.
- A `notification_log(id, user_id, kind, dedupe_key, sent_at,
  payload jsonb)` so we never double-send (the kind of bug the
  `firm_activity_reads` / reminder-dedupe work already guards
  against — reuse that thinking; see
  `20260511000002_reminders_dedupe.sql`,
  `20260514000004_firm_phase4_notifications.sql`).

**Client token capture** — extend `CapacitorNativeInit.tsx`: add the
`PushNotifications.addListener('registration', …)` and
`'registrationError'` handlers (guarded by `isPluginAvailable`, same
as today) and POST the token to `POST /api/push/register` →
upsert `device_tokens`. `pushNotificationActionPerformed` listener
routes taps/actions (Phase 2).

**Send service** — `lib/push/send.ts` behind a `PushProvider`
interface so the unit tests use a fake and prod uses APNs (HTTP/2,
token-based `.p8` — the project already mints ES256 JWTs with
`node:crypto` for App Store Connect; reuse that primitive, no new
dep) and FCM v1. Pure `buildPayload(event)` functions are unit-
tested; the transport is mocked.

**Operator-gated (cannot be done in code):** APNs key (`.p8` +
Key ID + Team ID) and the iOS *Push Notifications* capability;
Firebase project + `google-services.json` + FCM service account.
These are credentials/console steps for the founder, documented in a
runbook section, exactly like the mileage Play-declaration follow-up.

## Phase 2 — actionable notifications (the "swipe to classify")

**Categories** (native, needs a build):

- `TRIP_CLASSIFY` — actions: **Business** / **Personal**. On the
  watch and lock screen these render as the two buttons; a left/right
  swipe surfaces them. (iOS notification actions are buttons; the
  "swipe" is the OS gesture that reveals them — we cannot repaint the
  system swipe, so the deliverable is two unambiguous one-tap
  actions, which is the same number of gestures.)
- `CLARIFY` — action: **Business** / **Personal** / **Open** for an
  ambiguous meal/expense (e.g. `category_code = 'meals'` or a trip
  `classification = 'unclassified'` / low `suggestClassification`
  confidence).
- iOS: `UNNotificationCategory` in the native layer. Android:
  notification channels + action buttons. Both are native config
  that ships in a build; the **payloads and handlers are
  CI-testable**.

**Handlers** — `POST /api/push/action` (session-validated, then
service-write — the standard pattern). Maps:

- `TRIP_CLASSIFY:business|personal` → the existing
  `reclassifyTrip` logic in `app/mileage/actions.ts` /
  `mileage_trips` (deduction recomputed via `tripDeductionCents`,
  already tested).
- `CLARIFY:*` for an expense → the existing expense update path
  (`app/c/[publicId]/expenses/actions.ts`).

No new tax/mileage math — these reuse Phase-2/P2.5 mileage code that
is already unit-tested. The handler just authenticates and dispatches.

## Phase 3 — event wiring (all four alert classes)

Each producer enqueues a notification (idempotent via
`notification_log.dedupe_key`) and the send service fans out to the
user's `device_tokens`:

- **Trip done** — at `/api/mileage/ingest` when a new trip is
  segmented: if `suggestClassification` is confident → `expense
  applied`-style FYI; if not → `TRIP_CLASSIFY` actionable.
- **Expense applied** — `addExpense` / receipt-extract commit / bank
  import (`app/c/[publicId]/import/actions.ts`): FYI with amount +
  category; if `meals` or low-confidence category → `CLARIFY`.
- **Goal met** — `lib/tax/savings-goals.ts` evaluation crossing a
  threshold.
- **Badge awarded** — `lib/badges/evaluate.ts` already returns the
  *newly* earned codes (unique-constrained, one-shot) — the natural
  enqueue point, no new dedupe needed.
- **Message** — `app/firm/threads/actions.ts` when a team member or
  tax preparer posts to a thread the user is on.

**Preferences + quiet hours** — extend the existing
`firm_notification_preferences` pattern to a per-user
`notification_preferences` (per-kind opt-out, quiet-hours window).
Defaults live in code so unconfigured users get sane behaviour
(same philosophy as the firm digest prefs). All pure → unit-tested.

## Phase 4 — dedicated watch app (optional, only if Phase 1–3 isn't enough)

Phases 1–3 already deliver the entire requested list on the wrist
via notification mirroring. Build a real watch app **only** for
richer-than-a-notification UX:

- watchOS: a SwiftUI target + `WatchConnectivity` to the iOS app, a
  **complication** (glanceable "next quarterly due" / "YTD
  deduction"), and a native trip card.
- Wear OS: a Compose Tile/complication.

Honest cost: separate native targets, separate signing &
submission, watchOS needs Xcode, and **none of it is web/CI-
verifiable**. The remote-WebView shell cannot host it. Treat as its
own project with its own spec if/when prioritised.

## Security / privacy

- APNs/FCM payloads are visible in transit metadata and on-device
  before unlock — **no PII or dollar amounts in the alert body**
  beyond what the user already consented to see on a lock screen;
  prefer "A receipt was added" over the vendor/amount, with detail
  behind unlock. Decide per-kind in `buildPayload`.
- Action handlers **re-authenticate** (session) and authorise the
  target row exactly like `reclassifyTrip` does — a notification
  action is untrusted input, never a capability token.
- Device tokens are user-scoped under RLS; revoke on
  `registrationError` / sign-out.

## Lessons carried in

- **Vet native plugin Capacitor-version pins before adopting.** The
  background-geolocation incident: npm `peerDependencies` looked
  Cap-8-safe but the iOS Swift package pinned Cap-7 and broke the
  archive. Any push/watch plugin gets the same SPM/Gradle check up
  front, and an `isPluginAvailable` guard so a binary without it
  no-ops cleanly (the #69 lesson).
- **Never blind-build native.** Phases 1–3 are structured so the
  logic is CI-proven; only OS delivery + an optional watch target
  need a device.
- **Push delivery infra is a known, pre-existing gap** (noted in
  `CapacitorNativeInit.tsx`) — Phase 1 closes it and unlocks
  quarterly-reminder push too, not just this feature.

## Phase plan

1. **Push backend**: `device_tokens` + `notification_log` migration,
   token capture, send service behind a provider interface, tested
   payload builders. Operator provisions APNs/FCM.
2. **Actionable**: `TRIP_CLASSIFY` / `CLARIFY` categories (native) +
   `/api/push/action` handlers reusing the tested reclassify/expense
   code.
3. **Event wiring**: trip / expense / goal / badge / message
   producers enqueue; preferences + quiet hours + de-dup.
4. **Dedicated watch app** (optional): watchOS + Wear OS targets.

Each phase is independently shippable; 1–3 are independently
CI/browser-verifiable. Only the OS-delivery seam and Phase 4 need a
device.
