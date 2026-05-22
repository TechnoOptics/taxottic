# Push notifications — new charge needs business/personal clarification

**Status:** Draft — awaiting Firebase setup before implementation
**Tracks:** Task #68

When a new bank transaction lands that we can't auto-classify, the user
should get a push on their phone:

> **Taxottic** · 9:14am
> $42.18 at HOME DEPOT — business or personal?

Tapping the notification opens the app at the row, with two big
swipe-or-tap buttons. The classification persists straight to
`bank_transactions.applied_category_code` (or `ignored=true` for
personal). The same row never notifies twice — `notification_log`
keyed by `(user_id, dedupe_key="charge_clarify:<txId>")` handles
idempotency.

## Prerequisites the user must complete first

Push delivery on Android requires Firebase Cloud Messaging. None of
this works until:

1. **Firebase Console**: create a project for Taxottic, register the
   `com.taxottic.app` Android app, download `google-services.json`.
2. **Repo**: drop `google-services.json` into `android/app/`. **Do
   NOT commit it** — it's an API config file. Add to `.gitignore`
   and place in Vercel as a build-time secret. CI / Capacitor's
   gradle picks it up at build.
3. **iOS (later)**: same dance with APNs auth key in Apple Developer
   Console, register the bundle ID for push capability.
4. **Env flag**: flip `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED=1` in
   Vercel so the gated `register()` call in CapacitorNativeInit
   actually fires.

The infrastructure below works without any of this — it lays
dormant. Once Firebase is configured the pipeline starts delivering.

## Trigger: when does the push fire?

A row in `bank_transactions` "needs clarification" when:

- `ignored = false` (user hasn't dismissed it)
- `applied_category_code IS NULL` (no Schedule C category set yet)
- `applied_expense_id IS NULL` AND `applied_income_id IS NULL`
- Stripe auto-apply pipeline didn't grab it (out of scope for that)

Two trigger options, leaning toward (B):

**(A) Postgres trigger** on `INSERT INTO bank_transactions WHERE ...`
   that calls an edge function. Pros: real-time. Cons: another moving
   piece + edge function deploy story; one more failure mode.

**(B) Server action at end of sync.** `/api/banks/plaid/sync` (and the
   Stripe equivalent) at the end of their write loop calls a
   `notifyUnclassifiedCharges(userId, newTxIds)` helper. Pros: in-tree,
   easy to test, no Postgres event surface. Cons: only fires on syncs
   we own — manual SQL inserts won't notify. Acceptable: there
   shouldn't be manual SQL inserts in steady state.

## Push payload contract

```json
{
  "title": "Taxottic",
  "body": "$42.18 at HOME DEPOT — business or personal?",
  "data": {
    "kind": "charge_clarify",
    "txId": "<bank_transactions.id>",
    "amountCents": "4218",
    "vendor": "HOME DEPOT"
  }
}
```

`data.kind` lets us route by intent in the in-app action handler.
`data.txId` lets the tap action navigate to the specific row and
pre-load the swipe deck on it.

## In-app action handler

`CapacitorNativeInit` already wires `PushNotifications.addListener(
"pushNotificationActionPerformed", ...)` and forwards to
`/api/push/action`. The route already handles the "swipe" classify
flow for trips (mileage). Extend it:

```ts
// app/api/push/action/route.ts (already exists for mileage)
if (data.kind === "charge_clarify") {
  const decision = body.actionId; // "business" | "personal" | "open"
  if (decision === "open") {
    // App is foregrounded with deep-link to /c/<id>/banks?focus=<txId>
    return NextResponse.json({ ok: true, did: "open" });
  }
  // Server-side classify via the same path /api/watch/confirm uses
  await classify(txId, decision);
  return NextResponse.json({ ok: true, did: "classify_charge" });
}
```

Bonus: on Android we can ship the notification with two action
buttons ("Business" / "Personal") so the user classifies WITHOUT
opening the app. Adds a single round-trip to `/api/push/action` with
the chosen `actionId`. iOS supports this via UNNotificationCategory
+ actions.

## Send pipeline

```
lib/push/send.ts
  - sendToUser(userId, payload): fan out across all
    device_tokens WHERE user_id = $1 AND revoked_at IS NULL
  - sendToToken(token, platform, payload): per-token wrapper
    - Android: HTTPS POST to https://fcm.googleapis.com/v1/projects/<projectId>/messages:send
      with OAuth bearer from a service-account JWT
    - iOS: HTTPS POST to https://api.push.apple.com/3/device/<token>
      with JWT signed by APNs auth key
    - Web (later): VAPID web-push protocol; out of scope today
  - On 410 Gone (token unregistered) → set revoked_at = now()

lib/push/dedupe.ts
  - Insert notification_log (user_id, "charge_clarify:<txId>", payload)
  - Unique constraint on (user_id, dedupe_key) makes second send a
    no-op (caught by ON CONFLICT DO NOTHING)
  - Send only fires if INSERT returned RETURNING id (i.e. it was
    actually inserted)
```

Server-side secrets needed in Vercel:

- `FCM_SERVICE_ACCOUNT_JSON` — full JSON of a Firebase service account
  with `cloudmessaging.messages.create` permission
- `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_PRIVATE_KEY` — for iOS,
  once we add it

## Test plan

- [ ] Land a new unclassified `bank_transactions` row via a fake
      Stripe sync → confirm `notification_log` gets a row, FCM
      receives the message, the phone shows the banner
- [ ] Tap "Business" action button → row's
      `applied_category_code` populates, `notification_log` keeps
      the original record (audit)
- [ ] Tap the notification body itself → app opens, navigates to
      `/c/<id>/banks?focus=<txId>`, banks page highlights the row
- [ ] Re-sync same row → no second notification (dedupe holds)
- [ ] Revoke device (sign-out clears the token via
      `device_tokens.revoked_at`) → next send returns 410 →
      automatic prune

## Open questions for the user

1. **Quiet hours?** Push at 3am on a Friday morning is rude. Do we
   suppress between, say, 10pm–8am user-local-time? Or always fire
   and let the OS handle Do Not Disturb?
2. **Batch?** If five charges land at once (typical Plaid morning
   sync), send five separate pushes or one combined "5 new charges
   to review"? My default is one-per-charge for the first 3, then
   roll up the rest as "+ 2 more" to avoid notification spam.
3. **Action buttons.** Worth the extra wiring (two action buttons on
   the notification itself) or start with tap-to-open and add later?
