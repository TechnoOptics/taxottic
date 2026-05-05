# Taxottic for Firms

**Year-round tax forecasting for the people you already serve**

Prepared by: Techno Optics LLC (Taxottic)
Effective: 2026-05-04
Owner: Sales & Partnerships, Techno Optics LLC
Contact: contact@taxottic.com

---

## 1. Executive summary

Taxottic gives an accounting or tax-prep firm a year-round forecasting cockpit for every individual and business client on its book. Bank feeds via Plaid land in the right Schedule C / 1040 buckets automatically. A clean dashboard shows each client's current-year tax exposure, deduction opportunities, and quarterly-estimate posture. Bella, the in-app assistant, answers tax questions for staff and clients in plain English.

Pricing is deliberately simple: a flat per-client annual fee, billed monthly, that covers everything needed to keep that client's forecast accurate. Three tiers let the firm match price to client complexity:

| Tier | Per client / year | Target client |
| --- | --- | --- |
| **Essentials** | **$50** | W-2 individuals (1040), light Schedule C |
| **Professional** | **$100** | Sole props, single-member LLCs, light S-corps |
| **Enterprise** | **$150** | Multi-entity, heavy Schedule C, K-1 partners, complex S-corps |

A firm pays only for active client engagements. There is no per-staff seat fee at any tier; staff log in under the firm's account and operate every client the firm has paid for.

## 2. What the firm gets

For every paid client engagement, the firm receives:

- **Year-round tax forecast.** Federal + state liability projection that updates as new transactions arrive. The forecast surfaces under-withholding before April, not after.
- **Automated bank ingest.** Plaid-powered bank, credit-card, and brokerage feeds. Transactions land already split between income and expense, mapped to the IRS deduction master list (1,025 line items).
- **Schedule C export.** One-click export of the year-to-date Schedule C, ready for the firm's tax software at filing time. CSV + JSON formats; no rekeying.
- **Quarterly estimate calculator.** Auto-computed Q1–Q4 estimated payments with safe-harbor logic. The firm can review and adjust before sending to the client.
- **Bella (in-app assistant).** Answers tax questions in plain English for both staff and clients. The firm decides whether clients can converse with Bella directly or only through the staff portal.
- **Document vault.** Encrypted storage for prior-year returns, organising statements, and IRS notices. AES-256 at rest, TLS in transit, SOC-aligned controls (see §6).
- **Client portal.** Each client gets a low-friction sign-in (passkey, Google, Microsoft) and a dashboard tailored to their entity type. Branding follows the firm's, not Taxottic's, on all higher tiers (see §3).

## 3. Pricing tiers, in detail

| Feature | Essentials ($50) | Professional ($100) | Enterprise ($150) |
| --- | :---: | :---: | :---: |
| Year-round forecast | Yes | Yes | Yes |
| Bank feeds via Plaid | 1 Item / client | Up to 3 Items / client | Unlimited Items |
| Schedule C export | Yes | Yes | Yes |
| Quarterly estimates | Yes | Yes | Yes |
| Bella, in-app assistant | Yes | Yes | Yes |
| Document vault | 100 MB / client | 1 GB / client | Unlimited |
| Client portal | Yes | Yes | Yes |
| Firm white-label (logo + domain) | — | Yes | Yes |
| Multi-entity support (S-corp, partnership) | — | Limited | Full |
| K-1 ingest and pass-through tracking | — | — | Yes |
| Priority support, 1-business-day SLA | — | Yes | Yes |
| Dedicated account manager | — | — | Yes |
| API access | — | — | Yes |

A firm can place each engagement on whichever tier matches the client. The firm is billed for the actual mix monthly, with one invoice covering every engagement.

## 4. Worked-out examples

The numbers below assume a steady-state firm with no churn. Real numbers vary; revisit at month 3 and month 12.

### Solo CPA / EA — 50 clients, mixed mix

Mix: 30 W-2 individuals (Essentials), 18 sole-props (Professional), 2 S-corps (Enterprise).

| Item | Math | Total |
| --- | --- | --- |
| Annual revenue to Taxottic | 30 × $50 + 18 × $100 + 2 × $150 | **$3,600** |
| Monthly invoice | $3,600 / 12 | **$300** |
| Time savings (firm-side) | ~3 hours / week recovered, conservatively | $11K – $20K / year saved labour |

For the firm: $300/month covers automated bookkeeping for the entire client base. The hours the firm reclaims are the real ROI; the line-item cost is a rounding error against billable rates.

### Small firm — 200 clients, 3 staff

Mix: 120 Essentials, 70 Professional, 10 Enterprise.

| Item | Math | Total |
| --- | --- | --- |
| Annual revenue to Taxottic | 120 × $50 + 70 × $100 + 10 × $150 | **$14,500** |
| Monthly invoice | $14,500 / 12 | **~$1,210** |
| Per-client average | $14,500 / 200 | $72.50 |

A firm at this scale typically spends 20–30 hours/week on bank-statement reconciliation across all clients. Replacing that with Plaid + Taxottic auto-categorisation pays for the platform inside the first quarter.

### Mid-sized firm — 1,000 clients, 12 staff

Mix: 600 Essentials, 350 Professional, 50 Enterprise.

| Item | Math | Total |
| --- | --- | --- |
| Annual revenue to Taxottic | 600 × $50 + 350 × $100 + 50 × $150 | **$72,500** |
| Monthly invoice | $72,500 / 12 | **~$6,040** |
| Per-client average | $72,500 / 1,000 | $72.50 |
| Volume discount available | 5,000+ clients | 10–20% off list |

Mid-sized firms also unlock the white-label portal at this size: clients sign in to `clients.<your-domain>.com`, the email templates carry the firm's logo, and Bella's introduction line names the firm.

## 5. Implementation

The firm goes live in three steps. Most firms are billing their first invoice within two weeks of the kickoff call.

1. **Kickoff and tenant provisioning (Day 1–3).** Firm signs the order form, picks a default tier, and chooses a subdomain. We provision the tenant, white-label assets, and a production Plaid integration.
2. **Staff onboarding (Day 3–7).** A 30-minute training covers the dashboard, the review queue, the Schedule C export, and Bella. We provide a written runbook the firm can keep on its intranet.
3. **Client onboarding (Day 7–30).** The firm invites clients in batches via the bulk-import tool. Each client receives a magic-link email; on first sign-in they connect their bank in under 90 seconds.

After onboarding, the platform is hands-off for the firm. Bank feeds sync automatically (see §7), forecasts update nightly, and the review queue surfaces only the transactions Taxottic was uncertain about.

## 6. Security and compliance

Taxottic is built for the regulated workflow firms operate in:

- **SOC-aligned controls.** Information Security Policy, Access Control Policy, Vulnerability Management Policy, and Data Retention and Disposal Policy are documented and reviewed at least annually. Policies are available on request.
- **Plaid Production review passed.** All four security attestations (vulnerability scanning, defined access control policy, zero-trust architecture, secure tokens and certificates) are attested and accepted by Plaid as of 2026-05-04.
- **Encryption.** AES-256 at rest, TLS 1.2+ in transit. Bank access tokens are encrypted with a key held outside the database; webhooks are JWT-verified against Plaid's published JWKS.
- **MFA.** Phishing-resistant authentication via passkeys (WebAuthn) and federated SSO (Google, Microsoft) for both staff and clients. Critical-systems access requires hardware-backed MFA at the IdP.
- **Data residency.** All client data resides in the United States (Supabase / AWS us-east-1). Backups are encrypted and retained for 30 days.
- **Right to deletion.** Per the Data Retention Policy, we delete a client's personal data within 30 days of a documented deletion request, and within 90 days from encrypted backups.

Full policies and the monthly compliance audit reports are made available to firms in their tenant's compliance section.

## 7. How the platform stays cost-efficient

Taxottic is engineered so per-client cost is predictable and bounded. This is what lets us hold list prices flat through 5,000 clients:

- **Bank syncs are throttled to one Plaid pull per connection per calendar month.** Webhooks acknowledge instantly but do not trigger a fresh API call once the month's pull has happened. The first sync after a new connection is bounded to year-to-date, not the default 24 months of history.
- **Forecasts recompute incrementally.** Adding a transaction touches one row, not the full forecast.
- **AI usage is metered.** Bella conversations route through our enterprise Anthropic agreement with caching; the firm sees a single Bella line on the invoice rather than per-token surprise charges.

A firm that wants to true-up an out-of-month sync can hit the "Sync now" button on any connection at any time without affecting the monthly bill.

## 8. Terms

- **Billing.** Monthly invoice, Net 15. Stripe ACH or card. The first invoice is prorated to the kickoff date.
- **Contract length.** Month-to-month after the first three months. The first three months are committed to allow for onboarding investment.
- **Mid-tier upgrades and downgrades.** A client engagement can be moved between tiers at any time; the change is prorated on the next invoice.
- **Termination.** Either side can terminate with 30 days written notice. On termination, the firm receives a CSV export of every client's transactions, forecasts, and stored documents.
- **Pricing freeze.** List prices in this proposal are guaranteed for the firm's first 24 months. After that, increases (if any) are capped at the lesser of CPI or 5% per year.

## 9. Next step

If the firm is ready to move forward, the order form is one page and lives at:

> https://taxottic.com/firms/order

Pick a default tier, list the staff who need login access, choose a subdomain, and we book the kickoff call within 48 hours.

Questions: **contact@taxottic.com**.

---

*Techno Optics LLC, operating Taxottic. This proposal is informational and does not constitute a binding offer. Final terms are contained in the order form and Master Services Agreement.*
