# Privacy data map — Apple nutrition labels + Google Data Safety

Authoritative source for the privacy declarations you fill in
App Store Connect ("App Privacy") and Play Console ("Data safety").
**Both stores reject or pull apps whose declarations don't match
actual behavior** — these answers are derived from the real
integrations in the codebase, not guessed.

## Confirmed data processors (sub-processors)

| Processor | Purpose | Data it receives |
|---|---|---|
| **Supabase** | Database, auth, storage | Email, name, all financial books data, uploaded documents |
| **Plaid** | Bank-account connections | Bank credentials are entered in Plaid's own widget (never touch our servers); we receive account + transaction data |
| **Stripe** | Subscription + invoice payments | Card data entered in Stripe's hosted flow (never touches our servers); we receive payment status + customer ID |
| **Anthropic** | Bella AI assistant | The text of questions the user asks Bella + relevant company context |
| **Resend** | Transactional email | Email address + message content (receipts, reminders) |

**No analytics/tracking SDK is installed** (no PostHog, Mixpanel,
Google Analytics, Firebase Analytics, ad SDKs). This is verified by
grep across `lib/` and `app/`. → "Used to track you: **None**".

---

## Apple — App Store Connect → App Privacy

### Data Used to Track You
**None.** (No cross-app/website tracking, no ad networks, no data
brokers.)

### Data Linked to You

| Category | Specific types | Purpose |
|---|---|---|
| Contact Info | Email address, Name | App Functionality, Account Management |
| Financial Info | Other financial info (income, expenses, tax estimates, bank-transaction data via Plaid) | App Functionality |
| Identifiers | User ID | App Functionality |
| User Content | Other user content (uploaded receipts/tax documents, Bella chat messages) | App Functionality |

### Data Not Linked to You
**None** (we don't collect anonymized/aggregated device data —
no analytics SDK).

### Notes for the App Privacy questionnaire
- "Do you or your third-party partners use data for tracking?" → **No**
- Payment card numbers: **not collected** (Stripe-hosted; never
  hits our servers — do **not** declare card number under Financial
  Info, because we genuinely never receive it)
- Bank credentials: **not collected** (Plaid Link widget; same
  reasoning)
- Privacy policy URL: `https://taxottic.com/legal/privacy`

---

## Google — Play Console → Data safety

### Does your app collect or share any of the required user data types?
**Yes — collects. Shares with the sub-processors above (as service
providers, not for advertising).**

### Data types

| Play category | Type | Collected | Shared | Processed ephemerally | Required | Purpose |
|---|---|---|---|---|---|---|
| Personal info | Name | Yes | No | No | Yes | App functionality, Account management |
| Personal info | Email address | Yes | No | No | Yes | App functionality, Account management |
| Financial info | Purchase history | Yes | No | No | No | App functionality |
| Financial info | Other financial info (income/expense/tax/bank-tx) | Yes | Yes (Plaid, Supabase) | No | Yes | App functionality |
| App activity | Other user-generated content (receipts, Bella chats) | Yes | Yes (Supabase, Anthropic) | No | No | App functionality |
| App info & performance | Crash logs | No | — | — | — | (none unless you add Crashlytics/Sentry later) |

### Security practices
- **Data encrypted in transit:** Yes (HTTPS/TLS everywhere)
- **Data encrypted at rest:** Yes (Supabase Postgres encryption;
  OAuth/bank tokens AES-256-GCM)
- **Users can request data deletion:** Yes — in-app at
  Settings → Account, and data export at `/settings/data`
- **Committed to Play Families policy:** N/A (not a kids app;
  rating Everyone/4+)
- **Independent security review:** No (don't claim one — there
  hasn't been a third-party pen test)

### Data deletion URL
`https://taxottic.com/settings/data` (export) — account deletion
is initiated in-app under Settings → Account.

---

## The one consistency rule

Apple's labels and Google's form **must tell the same story**. The
mapping above is already reconciled:

- Both: collect Name, Email, Financial info, User content
- Both: **no tracking, no analytics, no ads**
- Both: card + bank credentials are *not collected* (hosted by
  Stripe/Plaid) — do not over-declare

If you later add Sentry/Crashlytics or any analytics, you **must**
update *both* declarations the same day or risk a compliance pull.
