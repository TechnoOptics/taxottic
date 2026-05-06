# Privacy disclosures — App Store + Google Play

Both stores require an exhaustive map of "what data leaves the
device, who gets it, why, is it encrypted, can the user delete it."
This document is the canonical answer set — copy these into the
App Store Connect → App Privacy and Play Console → Data Safety
forms.

The questions are framed slightly differently per store but the
underlying answers are identical and grounded in our actual stack:
Plaid, Stripe, Anthropic, Supabase, Vercel, Resend.

---

## Data we collect

### Identifiers

| Type | Used for | Linked to user? | Tracking? |
|---|---|---|---|
| Email address | Auth, password resets, billing receipts, security alerts | Yes | No |
| Full name | Display, tax return prep | Yes | No |
| User ID (auth.users.id, UUID) | App functionality | Yes | No |

### Financial info

| Type | Used for | Linked to user? | Tracking? |
|---|---|---|---|
| Bank account info (via Plaid Link) | Auto-categorize transactions | Yes — encrypted | No |
| Transaction history (via Plaid) | Forecasting + deductions | Yes — encrypted | No |
| Tax filing status, age, dependents | Forecasting | Yes | No |
| W-2 / 1099 / Schedule C amounts | Forecasting | Yes | No |
| Payment info (credit card) | Subscription billing | **No — handled by Stripe; we never see card numbers** | No |

### User content

| Type | Used for | Linked to user? | Tracking? |
|---|---|---|---|
| Receipt images / PDFs | OCR extraction | **No — sent to Anthropic for parsing, not retained** | No |
| W-2 / 1099 PDFs | OCR extraction | Same — transient, not retained | No |
| Bella chat messages | AI assistant | Yes — saved to your conversation history; never used for model training | No |
| Notes on transactions / expenses | Bookkeeping | Yes | No |

### Usage data

| Type | Used for | Linked to user? | Tracking? |
|---|---|---|---|
| Pages visited (Vercel logs) | Operational debugging | No — IP truncated, no user-id join | No |
| Crash logs (Vercel) | Reliability | No | No |
| Push notification tokens | Quarterly reminders | Yes | No |

### Diagnostics

We do **not** use third-party analytics SDKs (no Google Analytics,
no Segment, no Mixpanel, no Amplitude). All product analytics are
derived from server-side database events.

---

## Data we do NOT collect

The following come up in App Store / Play Store questionnaires;
answer "Not collected" for all:

- Precise or approximate location
- Browsing history outside the app
- Search history
- Photos or videos NOT explicitly uploaded by the user
- Audio data
- Health & fitness data
- Contacts / address book
- Calendar events
- Files and docs other than tax-doc uploads
- Sensitive info (race, religion, sexual orientation, political views, biometric, genetic, trade union)

---

## Apple "App Privacy" exact answers

App Store Connect → App Privacy → "Get Started"

### Data Used to Track You

**No data used for tracking.** (Tracking = sharing with third
parties for advertising. We do none of this.)

### Data Linked to You

Tick these boxes only:

- [x] **Contact Info** → Email Address, Name
- [x] **Financial Info** → Other Financial Info (transaction history, tax fields)
- [x] **User Content** → Other User Content (receipts, W-2 uploads, Bella messages, notes)
- [x] **Identifiers** → User ID
- [x] **Usage Data** → Product Interaction (in-app navigation for support)

For each ticked category, select these purposes:
- App Functionality ✓
- Analytics ✓ (only Product Interaction)
- App Functionality + Analytics ← never select Advertising / Tracking

### Data Not Linked to You

Tick:

- [x] **Diagnostics** → Crash Data, Performance Data

### Privacy policy URL

`https://taxottic.com/legal/privacy`

---

## Google "Data Safety" exact answers

Play Console → App content → Data safety → "Manage"

### Data collected

For each item below, mark "Yes, collected" with these settings:

| Item | Collected? | Shared w/ 3rd party? | Optional? | Encrypted in transit? | User can delete? |
|---|---|---|---|---|---|
| Name | Yes | No | Required | Yes | Yes |
| Email address | Yes | No | Required | Yes | Yes |
| User IDs | Yes | No | Required | Yes | Yes |
| Other financial info (transaction data) | Yes | **Yes — Plaid (processor)** | Required for the bank-sync feature, optional otherwise | Yes | Yes |
| Photos (receipts) | Yes | **Yes — Anthropic (processor, transient)** | Optional | Yes | Yes |
| Files & docs (W-2 etc) | Yes | **Yes — Anthropic (processor, transient)** | Optional | Yes | Yes |
| In-app messages (Bella) | Yes | **Yes — Anthropic (processor)** | Optional | Yes | Yes |
| Other actions (clicks, page views) | Yes | No | Required | Yes | Yes |
| Crash logs | Yes | No | Optional | Yes | Yes |
| Diagnostic logs | Yes | No | Optional | Yes | Yes |

### Security practices

- [x] Data is encrypted in transit
- [x] Data is encrypted at rest
- [x] Users can request that their data be deleted
- [x] Independent security review (mention SOC 2 if/when achieved)

### Data deletion

`https://taxottic.com/legal/privacy#data-deletion` — the existing
privacy page links the "Delete my account" button which cascades
all PII per our Supabase RLS policies.

---

## Third-party processor mapping

These ride on our backend; users don't directly authorize them, but
the privacy policy and Data Safety forms must disclose them.

| Processor | What they touch | Why | Where in policy |
|---|---|---|---|
| Plaid | Bank account credentials + transaction history | Bank import / sync | "Banking integrations" section |
| Stripe | Email + card | Subscription billing | "Payment processing" |
| Anthropic | Receipt images, W-2s, Bella chat messages | OCR extraction + AI assistant. **Per Anthropic's API ToS, prompts are NOT used for model training** | "AI features" |
| Supabase | All app data (Postgres) | Backend storage | "How your data is stored" |
| Vercel | Server logs (IP truncated) | Hosting | "Hosting" |
| Resend | Email address | Sending email (auth, receipts, reminders) | "Communications" |

The privacy policy at https://taxottic.com/legal/privacy already
names these. Confirm before submission that the exact wording
matches what's in the Data Safety form.

---

## CCPA / GDPR posture

- The privacy policy declares Taxottic LLC as data controller.
- A "Delete my account" link in /settings (referenced in `app/settings/page.tsx`) cascades through all user-linked rows via Supabase RLS + the `auth.users` cascade FK in our migrations.
- Data export endpoint at `/api/account/export` returns a JSON dump (already implemented).
- We do not sell personal information.
- Children under 13 are not the target audience and the registration flow rejects birthdays under 13.
