# Store listing content pack — paste-ready

Every text field both stores ask for, written and ready to paste.
Character limits are noted; everything here is within them.

---

## Shared

- **App name:** Taxottic
- **Bundle ID / Package:** `com.taxottic.app`
- **Primary category:** Finance
- **Secondary category:** Business
- **Content rating:** 4+ / Everyone (no objectionable content)
- **Support URL:** `https://taxottic.com/help`
- **Marketing URL:** `https://taxottic.com`
- **Privacy policy URL:** `https://taxottic.com/legal/privacy`
- **Support email:** `contact@taxottic.com`
- **Copyright:** `© 2026 Techno Optics LLC`

---

## Apple App Store Connect

### Subtitle (30 char max)
```
Tax forecasting, made calm
```
(26 chars)

### Promotional text (170 char max — editable anytime without review)
```
Know what you'll owe before tax season. Live forecasts from your real books, IRS-cited guidance, and clean Schedule C drafts. Built for freelancers and the firms who serve them.
```
(169 chars)

### Description (4000 char max)
```
Taxottic turns the books you already keep into a clear answer to one question: what will I owe?

FORECAST, NOT GUESSWORK
See your projected federal and state tax update in real time as income and expenses change. Quarterly estimate targets, refund or balance-due projections, and a save-this-much-per-month number — all derived from current-year tax tables, not last year's rules of thumb.

BUILT ON YOUR REAL NUMBERS
Connect a bank securely through Plaid and let transactions categorize themselves, or enter figures by hand. Either way the forecast reflects your actual business, including multi-state income, self-employment tax, QBI, and entity-specific math for sole props, LLCs, S-Corps, partnerships, and C-Corps.

ASK BELLA
A built-in assistant that answers deduction and tax-code questions and cites its sources from a curated knowledge base. Educational guidance, in plain language, when you need it.

DRAFTS THAT SAVE HOURS
Generate clean Schedule C, K-1, 1099-NEC/MISC, and form drafts from your books. Every draft is clearly watermarked for professional review before filing — a starting point, not a substitute for your CPA.

FOR FIRMS
Accounting practices get a multi-client cockpit: branded client portals, document e-signature, scheduling, invoicing through Stripe Connect, and a per-client readiness view. Onboard a year of clients in one paste.

HONEST ABOUT WHAT THIS IS
Taxottic produces forecasts and drafts. It is not tax advice and not a filed return. Always have a licensed tax professional review the numbers before you pay, sign, or file. See https://taxottic.com/legal/terms

Free to start. Paid plans from $4.99/mo. Cancel anytime.
```
(~1,520 chars — well under limit)

### Keywords (100 char max, comma-separated, no spaces)
```
tax,forecast,freelancer,self-employed,quarterly,estimate,schedule c,1099,deduction,small business,cpa
```
(99 chars)

### What's New (version 1.0)
```
First release. Real-time tax forecasting, bank-connected categorization, Bella AI guidance, and document drafts for freelancers and accounting firms.
```

### App Review notes (free text → Review team)
```
Taxottic is a tax-forecasting web app delivered through a Capacitor shell that loads https://taxottic.com.

Most functionality requires sign-in. Demo account:
  Email: review@taxottic.com
  Password: [SET A TEMP PASSWORD AND PASTE IT HERE BEFORE SUBMITTING]
The demo account is pre-seeded with sample company books so all forecast, document, and firm-cockpit screens are populated.

Native value-add beyond the web view: device camera for receipt capture (@capacitor/camera), push notifications for tax-deadline reminders (@capacitor/push-notifications), haptics, and native status-bar/splash theming.

Payments: subscription purchase is handled on the web at https://taxottic.com/billing via Stripe. [SEE PAYMENT-COMPLIANCE DECISION — pick IAP or External Link Account Entitlement before submitting; review notes must match the chosen model.]

No third-party analytics or tracking SDKs are present.
```

### Age rating questionnaire
- All categories: **None / No**
- Result: **4+**

### Export compliance
- "Does your app use encryption?" → **Yes** (standard HTTPS only)
- "Does it qualify for exemption?" → **Yes** (only exempt
  encryption — HTTPS/TLS)
- This already matches `ITSAppUsesNonExemptEncryption=false` in
  Info.plist, so App Store Connect won't ask again per build.

---

## Google Play Console

### App name (30 char max)
```
Taxottic
```

### Short description (80 char max)
```
Real-time tax forecasting for freelancers and the firms who serve them.
```
(71 chars)

### Full description (4000 char max)
Use the same body as the Apple Description above (it is within
Play's 4000-char limit and contains no Apple-specific terms).

### App category
Finance

### Tags
Finance, Business, Productivity

### Store listing contact
- Email: `contact@taxottic.com`
- Website: `https://taxottic.com`
- Phone: optional (Play allows blank)

### Content rating (IARC questionnaire)
- Violence / sexual / language / controlled substances / gambling:
  **None** across the board
- Result: **Everyone**

### Government / financial app declaration
Play asks if the app provides financial services. Answer:
- "Is your app a financial product or service?" → **Yes**
- Type → **Personal financial management / tax-preparation tools**
- It does NOT: lend money, trade securities, custody funds, or
  offer insurance → answer those sub-questions **No**
- Provide the privacy policy + a short note: "Taxottic is a
  tax-forecasting and bookkeeping-assist tool. It does not move
  money, lend, or provide regulated financial advice."

### Target audience & content
- Target age: **18+** (financial tool; avoids the kids-app
  compliance surface entirely)
- Appeals to children: **No**

---

## Screenshots — what to capture

Use the demo account (`review@taxottic.com`) so screens are
populated. Capture these flows, in this order (first 2-3 are the
ones that convert):

1. **Forecast dashboard** — the headline projected-tax number +
   the save-per-month figure
2. **Bank-connected categorization** — transactions auto-sorting
3. **Bella** — a question with a cited answer
4. **Schedule C draft** — the generated draft with DRAFT watermark
5. **Firm cockpit** — the multi-client roster (for the B2B story)

### Required sizes
**iOS:**
- iPhone 6.7" — 1290 × 2796
- iPhone 6.5" — 1242 × 2688
- iPad Pro 12.9" (3rd gen+) — 2048 × 2732

**Android:**
- Phone — min 1080 × 1920 (2–8 screenshots)
- 7" tablet — min 1200 × 1920
- 10" tablet — min 1920 × 1200
- Feature graphic — **1024 × 500** (required by Play; a branded
  banner with the wordmark + tagline)

You can capture iOS screenshots from the Simulator on the same
macOS CI box (or any Mac), and Android from an emulator on
Windows. There is no automated screenshot step in the pipeline —
this is manual but one-time.
