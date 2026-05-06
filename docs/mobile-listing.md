# App Store + Play Store listing copy

Copy these fields into App Store Connect and Google Play Console.
Both stores limit the lengths shown in the table — use the trimmed
version for the constrained field, the long version for full
description.

---

## App name

**Taxottic** (12 chars — fits both stores)

## Subtitle (App Store, ≤30 chars)

**Tax forecasting + AI**

## Short description (Play, ≤80 chars)

**Forecast taxes, capture deductions, never miss a quarterly.**

---

## Promotional text (App Store, ≤170 chars; editable post-launch)

> Snap receipts to deduct them. Connect your bank to auto-categorize
> every transaction. See your year-end tax bill update live as you
> work.

---

## Full description (≤4,000 chars App Store / Play)

```
Taxottic is the modern way for self-employed individuals,
freelancers, and small businesses to forecast taxes and capture
every deduction.

Stop wondering what you'll owe. Start the year with a plan.

WHAT YOU GET

• Live tax forecast — federal, state, and self-employment tax
  projected to year-end based on your real income and expenses
• Quarterly estimate calendar — exactly what to send the IRS on
  Apr 15, Jun 15, Sep 15, and Jan 15
• 50+ deduction categories — vehicle, home office, software,
  travel, meals, retirement, HSA, and more
• Receipt scanning — snap a photo, our AI reads vendor, total,
  date, and category in 3 seconds
• Bank connections — link any major US bank, every transaction
  auto-categorized
• W-2 + 1099 import — drop your forms, we extract the numbers
• Bella, your tax assistant — ask anything in plain English

TAX-SAVINGS PLAYBOOK

A personalized list of moves you can still make this year:
• Max your 401(k) or open a Solo 401(k)
• Open a SEP-IRA, SIMPLE IRA, or Defined Benefit plan
• HSA + FSA contributions
• Tax-loss harvesting before December 31
• Bunch charitable giving via a Donor-Advised Fund
• 529 plan contributions for state tax deductions
• Backdoor Roth, Mega Backdoor Roth, Spousal IRA
• EV credit + Energy Efficient Home Improvement Credit

Every recommendation includes step-by-step instructions and the
estimated dollar savings at YOUR marginal tax rate.

WHO USES TAXOTTIC

• Freelancers + 1099 contractors
• Sole proprietors + single-member LLCs
• S-Corps + multi-member LLCs
• W-2 employees with side income
• CPAs and tax preparers managing client books

PLANS

• Filer ($4.99/mo) — Personal forecast, no business
• Solo ($19.99/mo) — Single business + bank sync
• Studio ($49/mo) — Multi-company + team
• Scale ($129/mo) — Mid-market + audit support
• Practice (from $299/mo) — CPA / preparer firms

7-day free trial of Solo on every new account, no credit card
required.

PRIVACY + SECURITY

• Bank credentials stored by Plaid (SOC 2 Type II), never on
  our servers
• Bank tokens encrypted with AES-256-GCM at rest
• Passkey + 2FA support
• You can export or delete your data any time
• We never sell your data

Subscriptions are managed at https://taxottic.com/billing.

Questions? hello@taxottic.com
```

---

## Keywords (App Store, ≤100 chars)

`tax,forecast,deductions,1099,quarterly,receipts,bookkeeping,self employed,freelancer,llc,scorp`

## Tags (Play, choose ≤5)

Finance, Tax, Bookkeeping, Personal Finance, Business

---

## Age rating

| Apple App Privacy questionnaire | Answer |
|---|---|
| Cartoon or fantasy violence | No |
| Realistic violence | No |
| Sexual content | No |
| Gambling | No |
| Unrestricted web access | No (we open a controlled WebView at taxottic.com) |
| Frequent / intense profanity | No |
| Frequent / intense alcohol, tobacco, drugs | No |
| Mature suggestive themes | No |
| Horror | No |
| Medical / treatment information | No |

→ App Store rating: **4+**

| Google Play content rating | Answer |
|---|---|
| Violence | No |
| Sexual content | No |
| Profanity | No |
| Drugs | No |
| Gambling | No |
| User-generated content | No (no public posting) |
| Shares user's location | No |
| Allows users to interact | Yes — team chat between same-company members |

→ Play rating: **Everyone** (target audience: 18+ for finance app)

---

## Screenshots required

### iOS (App Store)

Apple needs ALL of these device sizes. Generate by opening Safari at
`https://taxottic.com` in those simulator sizes.

| Device | Resolution | Required? |
|---|---|---|
| 6.7" iPhone (15 Pro Max) | 1290 × 2796 | **Required** |
| 6.5" iPhone (XS Max, 11 Pro Max) | 1242 × 2688 | **Required** |
| 5.5" iPhone (8 Plus) | 1242 × 2208 | Required if app supports older devices |
| 12.9" iPad Pro | 2048 × 2732 | **Required** if app runs on iPad |

3-10 screenshots per size. Recommended sequence:

1. Year-end forecast hero ("$23,847 owed at this pace")
2. Tax-savings playbook list view
3. Receipt scanning in action (camera UI + parsed result)
4. Bank-import auto-categorize (review screen with tx rows)
5. Quarterly estimates table
6. Bella asking a question with a citation

### Android (Play)

| Type | Resolution | Required? |
|---|---|---|
| Phone | 1080 × 1920 | **Required** (min 2, max 8) |
| 7" tablet | 1024 × 600 | Optional |
| 10" tablet | 1280 × 800 | Optional |

Same content as iPhone shots — 1-3 most compelling are enough.

### Feature graphic (Play, **required**)

1024 × 500 — promotional banner shown at the top of the Play
listing. Use the existing Taxottic forest-green background with the
wordmark + tagline "Forecast taxes, capture deductions."

---

## App icon

1024 × 1024 PNG, no alpha channel, no rounded corners (Apple +
Google round it for you). Source: `assets/icon.png` (already
generated from `public/brand/icon-mark-1024.png`).

---

## Localizations

English (US) only at launch. Spanish + French queued for v1.1 —
the web app strings already extract via Next.js i18n; only the
store-listing copy and screenshots need localized variants.
