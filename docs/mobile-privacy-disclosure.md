# Privacy disclosures — App Store + Google Play

Both stores require an exhaustive map of "what data leaves the device,
who gets it, why, is it encrypted, can the user delete it." This
document is the canonical answer set — copy these into the App Store
Connect → App Privacy and Play Console → Data Safety forms.

**Last reconciled against the code: 2026-08-08.** Before that, this file
had not been touched since the original Capacitor shell commit, so it
predated mileage tracking, push notifications, team chat, bank imports
and document storage. It declared several things that were no longer
true. See "What changed and why" at the bottom, and re-reconcile whenever
a new permission, SDK or stored data type lands.

> **A wrong answer here is not a paperwork problem.** Declaring "no
> location" while shipping background GPS is grounds for rejection and,
> after the fact, removal. Answer from the code, not from memory.

---

## Ground truth: what the app actually requests

Read from the manifests on 2026-08-08. Update this table first, then the
store answers below.

| Permission | Platform | What it is for |
|---|---|---|
| `NSLocationWhenInUseUsageDescription` | iOS | Mileage capture while the app is open |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | iOS | **Background** mileage capture |
| `UIBackgroundModes: location` | iOS | Keeps capture running with the app closed |
| `NSMotionUsageDescription` | iOS | Detect a drive ended (parked and walked away) |
| `NSCameraUsageDescription` | iOS | Photograph receipts and tax documents |
| `NSPhotoLibraryUsageDescription` / `...AddUsageDescription` | iOS | Attach an existing image, save a captured copy |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | Android | Mileage capture |
| `ACCESS_BACKGROUND_LOCATION` | Android | **Background** mileage capture |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_LOCATION` | Android | The capture service |
| `CAMERA` | Android | Receipt capture |
| `POST_NOTIFICATIONS` | Android | Reminders and tracker alerts |
| `BLUETOOTH` / `BLUETOOTH_CONNECT` | Android | Vehicle-presence detection (on-device only) |
| `RECEIVE_BOOT_COMPLETED` | Android | Re-arm capture after a reboot |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Android | Keep capture alive |

---

## Data we collect

### Location  ← COLLECTED. This is the big one.

| Type | Used for | Linked to user? | Tracking? |
|---|---|---|---|
| **Precise location (GPS), including in the background** | Measuring drive distance for the IRS mileage deduction | Yes | No |

Stored in `mileage_points_raw` as `lat`, `lng`, `speed_mps`,
`accuracy_m`, `captured_at`, keyed to `driver_user_id` and `company_id`.
Retained as the audit trail behind a claimed deduction, which is the
point: a mileage deduction that cannot be evidenced is worthless.

Also derived and stored: **inferred frequent places**
(`mileage_learned_places`), used to arm geofences. In practice these
amount to a user's home and workplace, which is more sensitive than any
single trip.

**Retention, from `app/api/cron/mileage-retention/route.ts`:**

| Data | Window |
|---|---|
| Raw fixes, once consumed into a trip | 30 days |
| Stranded raw fixes (never consumed) | swept at 45 days, deleted 30 days later |
| Device heartbeats | 30 days |
| `mileage_points` and `mileage_trips` | **no expiry job exists** |

State the last row honestly. Both stores ask how long data is kept, and
"indefinitely, as the deduction audit trail" is a defensible answer;
claiming a window that no cron enforces is not.

Three things the store forms specifically ask about, all of which are
true here and must be answered honestly:

1. **It runs in the background**, with the app closed. iOS declares
   `UIBackgroundModes: location`; Android declares
   `ACCESS_BACKGROUND_LOCATION` plus a location foreground service.
2. **It is precise**, not coarse.
3. **A company manager can see an employee's drives, including the GPS
   breadcrumbs.** The `mileage_trips manager + firm read` RLS policy
   grants a manager `select` on every trip in their company, and
   `mileage_points follow trip visibility` grants the matching points.
   This is disclosed as sharing with the employer, not with a third
   party, but it must be disclosed: it is the least obvious and most
   sensitive flow in the product.

### Identifiers

| Type | Used for | Linked to user? | Tracking? |
|---|---|---|---|
| Email address | Auth, password resets, billing receipts, security alerts | Yes | No |
| Full name | Display, tax return prep | Yes | No |
| User ID (`auth.users.id`, UUID) | App functionality | Yes | No |

### Employment info

| Type | Used for | Linked to user? | Tracking? |
|---|---|---|---|
| Employee number, job title, department (`company_members`) | Attributing expenses and drives within a company | Yes | No |

Visible to managers of the same company by design.

### Financial info

| Type | Used for | Linked to user? | Tracking? |
|---|---|---|---|
| Bank account info (via Plaid Link) | Auto-categorize transactions | Yes, encrypted | No |
| Transaction history (via Plaid, and CSV import) | Forecasting + deductions | Yes, encrypted | No |
| Tax filing status, age, dependents | Forecasting | Yes | No |
| W-2 / 1099 / Schedule C amounts, pay stub amounts | Forecasting | Yes | No |
| Payment info (credit card) | Subscription billing | **No, handled by Stripe; we never see card numbers** | No |

### User content

| Type | Used for | Linked to user? | Tracking? |
|---|---|---|---|
| Receipt images / PDFs | OCR extraction | Yes | No |
| Tax documents (`firm_documents`, `prior_year_documents`, `audit_documents`) | Return prep, audit support | **Yes, RETAINED** | No |
| Bella chat messages | AI assistant | Yes, saved to conversation history; never used for model training | No |
| **Team chat messages and attachments** (`chat_conversations`, `chat_attachments`) | Colleague messaging inside a company | Yes | No |
| Notes on transactions / expenses | Bookkeeping | Yes | No |

> Documents are **retained**, not transient. An earlier version of this
> file claimed uploads were "sent to Anthropic for parsing, not
> retained". That is false for anything stored in the document tables
> above. Anthropic sees a document transiently during extraction; the
> document itself persists in our storage until the user deletes it.

### Usage and diagnostics

| Type | Used for | Linked to user? | Tracking? |
|---|---|---|---|
| Pages visited (Vercel logs) | Operational debugging | No, IP truncated, no user-id join | No |
| Crash logs (Vercel) | Reliability | No | No |
| Push notification tokens | Reminders, tracker alerts | Yes | No |
| **Device health heartbeats** (`mileage_device_heartbeats`) | Detecting a tracker that has silently stopped | **Yes** | No |

The heartbeat carries app version, platform, whether tracking is
enabled, buffer depth, callback age, location authorization level,
battery-optimization and low-power state, OS exit reason, and whether
the app was foregrounded. It is diagnostics, but it is **linked to the
user**, so it cannot be filed under Apple's "Data Not Linked to You".

### On-device only, never transmitted

Worth stating explicitly because the permissions imply otherwise:

- **Motion and step activity** (iOS `CMPedometer`). Used to detect that a
  drive ended. Only a boolean "is motion permission granted" is reported;
  no step counts, cadence, or activity history leaves the device.
- **Bluetooth** and audio-route inspection. Used to infer vehicle
  presence. No device names, addresses, or pairing data are transmitted.

---

## Data we do NOT collect

- Browsing history outside the app
- Search history
- Photos or videos NOT explicitly uploaded by the user
- Audio recordings
- Health and fitness data (motion is read on-device only; see above)
- Contacts / address book
- Calendar events
- Sensitive info (race, religion, sexual orientation, political views, biometric, genetic, trade union)

---

## Apple "App Privacy" exact answers

App Store Connect → App Privacy → "Get Started"

### Data Used to Track You

**No data used for tracking.** (Tracking = sharing with third parties
for advertising. We do none of this.)

### Data Linked to You

- [x] **Location** → **Precise Location** — purpose: App Functionality
- [x] **Contact Info** → Email Address, Name
- [x] **Financial Info** → Other Financial Info (transaction history, tax fields)
- [x] **User Content** → Photos or Videos (receipts), Other User Content (documents, Bella messages, team chat, notes)
- [x] **Identifiers** → User ID
- [x] **Usage Data** → Product Interaction
- [x] **Diagnostics** → Other Diagnostic Data (device health heartbeats)

Purposes: App Functionality for all; Analytics additionally for Product
Interaction. Never select Advertising or Tracking.

### Data Not Linked to You

- [x] **Diagnostics** → Crash Data, Performance Data (Vercel, no user join)

Do **not** file the mileage heartbeat here: it is keyed to
`driver_user_id`.

### Privacy policy URL

`https://taxottic.com/legal/privacy`

---

## Google "Data Safety" exact answers

Play Console → App content → Data safety → "Manage"

| Item | Collected? | Shared w/ 3rd party? | Optional? | Encrypted in transit? | User can delete? |
|---|---|---|---|---|---|
| **Precise location** | **Yes** | No (visible to the user's employer) | Optional (mileage tracking is opt-in) | Yes | Yes |
| **Approximate location** | **Yes** | No | Optional | Yes | Yes |
| Name | Yes | No | Required | Yes | Yes |
| Email address | Yes | No | Required | Yes | Yes |
| User IDs | Yes | No | Required | Yes | Yes |
| Other financial info (transaction data) | Yes | **Yes, Plaid (processor)** | Required for bank sync, optional otherwise | Yes | Yes |
| Photos (receipts) | Yes | **Yes, Anthropic (processor, transient)** | Optional | Yes | Yes |
| Files & docs (W-2, prior-year, audit) | Yes | **Yes, Anthropic (processor, transient)** | Optional | Yes | Yes |
| In-app messages (Bella + team chat) | Yes | **Yes, Anthropic for Bella only** | Optional | Yes | Yes |
| Other actions (clicks, page views) | Yes | No | Required | Yes | Yes |
| Crash logs | Yes | No | Optional | Yes | Yes |
| Diagnostic logs (device health) | Yes | No | Required for tracking | Yes | Yes |

### Additional Play requirements that come with background location

These are separate from Data Safety and are the usual reason a release
is rejected or stalled:

1. **Background location permission declaration form**, in Play Console →
   App content. Requires a written justification and, in practice, a
   **demo video** showing the in-app flow where the user grants
   background location and sees what it does.
2. **Prominent in-app disclosure** shown BEFORE the system permission
   prompt, naming background collection and its purpose. Verify the
   onboarding screen still does this before each submission.
3. **Foreground service type declaration** for `location`, matching
   `FOREGROUND_SERVICE_LOCATION` in the manifest.
4. Location must remain **optional**: the app has to be usable without
   granting it. It is, since mileage tracking is opt-in per user.

### Security practices

- [x] Data is encrypted in transit
- [x] Data is encrypted at rest
- [x] Users can request that their data be deleted
- [ ] Independent security review (only tick when a SOC 2 or equivalent exists; do not tick aspirationally)

### Data deletion

`https://taxottic.com/legal/privacy#data-deletion`

---

## Third-party processor mapping

| Processor | What they touch | Why |
|---|---|---|
| Plaid | Bank account credentials + transaction history | Bank import / sync |
| Stripe | Email + card | Subscription billing |
| Anthropic | Receipt images, tax documents, Bella chat | OCR extraction + AI assistant. Full unredacted file bytes are sent, so a W-2 image carries an SSN even though we never parse or store one |
| **Google Maps Platform** | **Trip coordinates** | Static route images and reverse geocoding of trip endpoints |
| Supabase | All app data (Postgres + storage) | Backend storage |
| Vercel | Server logs (IP truncated) | Hosting |
| Resend | Email address | Auth, receipts, reminders |
| Apple APNs / Google FCM | Push tokens, notification content | Delivering notifications |

> **Location IS shared with a third party.** An earlier draft of this
> file (2026-08-08, before this correction) claimed location "is sent to
> none of them" and goes to Supabase only. That is false.
> `lib/maps/static-map.ts` puts raw points into a Google Static Maps
> URL, and `lib/maps/reverseGeocode.ts` sends trip endpoints to Google's
> Geocoding and Places APIs. Answer "shared with third parties: Yes" for
> both location types on the Play form.

On the Anthropic no-training point: that is a **contractual** claim. Do
not state it as fact in a store form or the policy unless the agreement
is confirmed to exist. The repo contains no evidence of it.

The privacy policy at https://taxottic.com/legal/privacy must name these
and must describe background location collection and employer
visibility. Confirm the wording matches this document before submitting.

---

## CCPA / GDPR posture

- **Techno Optics LLC**, a Massachusetts limited liability company, is
  the data controller. Taxottic is the product; the LLC is the entity.

  This line read "Taxottic LLC" until 2026-08-16, which named an entity
  that does not appear anywhere in the user-facing legal pages. Both
  app/legal/privacy/page.tsx and app/legal/terms/page.tsx say "Techno
  Optics LLC, a Massachusetts limited liability company". Store privacy
  declarations are filled in FROM this document, so the discrepancy would
  have told Apple and Google one controller while telling users another.

- **STREET ADDRESS: still missing, and it is required.** GDPR Art. 13(1)(a)
  wants the controller's identity AND contact details, and both store
  privacy forms have an address field. No postal address exists anywhere
  in this repository. It cannot be invented here; it has to come from the
  LLC's registration. Fill it in before the next submission.
- "Delete my account" cascades all user-linked rows via the `auth.users`
  cascade FK.
- Data export at `/api/account/export`.
- We do not sell personal information.
- Children under 13 are not the target audience; registration rejects
  birthdays under 13.
- **Employer access:** where a user is a member of a company, their
  drives, expenses and employment fields are visible to that company's
  managers. This is a controller-to-controller disclosure and belongs in
  the privacy policy, not only here.

---

## What changed and why (2026-08-08)

Reconciled against the manifests and the live schema. Corrections:

1. **Location moved from "not collected" to collected, precise, and
   background.** The old file listed "Precise or approximate location"
   under data we do NOT collect, while the app shipped continuous
   background GPS. This was the single most serious error in the file.
2. **Documents are retained, not transient.** `firm_documents`,
   `prior_year_documents` and `audit_documents` persist uploads.
3. **Team chat added.** Colleague-to-colleague messages and attachments
   were absent entirely.
4. **Device health heartbeats added**, and filed as diagnostics LINKED to
   the user, since they are keyed to `driver_user_id`.
5. **Employment info added** (employee number, title, department).
6. **Motion and Bluetooth documented as on-device only**, so the
   permissions do not read as undisclosed collection.
7. **Employer visibility of drives called out**, including the RLS
   policies that grant it.
8. **Play background-location obligations listed** (declaration form,
   demo video, prominent disclosure, foreground service type).
9. **Untucked the aspirational "independent security review" tick.**

10. **Google Maps Platform added as a location recipient**, correcting a
    false "location is shared with nobody" line in this same rewrite.
11. **Retention windows stated**, including that `mileage_points` and
    `mileage_trips` have no expiry job.
12. **Inferred frequent places added** (effectively home and workplace).
13. **Anthropic no-training claim softened** to a contractual claim
    needing confirmation, matching how `/legal/privacy` now words it.

### Still needs a human before submission

- **Record the Play background-location demo video.**
- **Confirm the in-app prominent disclosure precedes the OS prompt** on
  both platforms, on a real device.
- **Confirm the Anthropic no-training agreement exists.** If it does
  not, this document, `/legal/privacy` and `/legal/subprocessors` all
  need changing together.
- Decide whether to keep "no expiry" on trips and points, or add a cron.
  Either is defensible; the current mismatch with
  `docs/DATA_RETENTION_AND_DISPOSAL_POLICY` (which promises caps nothing
  enforces) is not.

`/legal/privacy` was revised on 2026-08-01 by an engineering pass that
read the schema, and it already covers background location, employer
visibility, Google Maps, document OCR and device telemetry. Its header
comment explicitly flagged that THIS file still declared location "not
collected" and left it, correctly, as an owner decision because it
changes a store answer. That is what this revision closes.

Both remain **unreviewed by an attorney**.
