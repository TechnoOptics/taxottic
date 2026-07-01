# Compliance roadmap — SOC 2, ISO 27001, HIPAA

> Honest status doc. **None of these are things you "turn on" in code.**
> They are audits, certifications, and legal programs that require written
> policies, third-party assessors, vendor agreements, and management
> attestations. Code can only satisfy the *technical* subset of controls.
> This file maps where we actually are and what the human/organizational
> work is. Do **not** publish any "certified / compliant" claim on the
> marketing site until the corresponding audit/cert is actually in hand —
> false compliance claims are a legal and reputational liability.

Last reviewed: 2026-07-01.

---

## TL;DR

| Framework | Applies to Taxottic? | Reality |
|---|---|---|
| **SOC 2** | ✅ Yes — expected by B2B/enterprise buyers of a fintech-adjacent SaaS | Achievable. ~3–6 mo to Type I, +3–12 mo observation to Type II. Needs an auditor (CPA firm) + evidence automation. |
| **ISO 27001** | ✅ Yes — useful for international/enterprise deals | Achievable. Heavy overlap with SOC 2. Needs an ISMS + accredited certification body. |
| **HIPAA** | ❌ **Almost certainly NOT applicable** | Taxottic processes **financial/tax data, not PHI**. "Health insurance" here is a deduction dollar amount, not protected health information. HIPAA governs covered entities / business associates handling PHI — we are neither. Pursuing it would be wasted spend and claiming it would be meaningless. See below. |

---

## HIPAA — why it does not apply (and what would change that)

HIPAA regulates **Protected Health Information (PHI)** held by *covered
entities* (health plans, providers, clearinghouses) or their *business
associates*. Taxottic is a tax-forecasting product for self-employed
filers. The only "health" data in the system is the **dollar amount of a
self-employed health-insurance premium deduction** and similar deduction
categories — financial figures, not medical records, diagnoses, or
treatment data. That is not PHI, and we are not a covered entity or a
business associate of one.

**Recommendation:** do not pursue HIPAA. If a future feature ingests
actual health records (e.g., an integration with a medical provider), or
we sign a Business Associate Agreement with a covered entity, revisit —
that would require a BAA with every subprocessor (Supabase, Vercel, etc.),
which is a materially different architecture.

---

## What's already in place (technical controls — verified in this repo)

- **TLS everywhere + HSTS** with `preload` (`next.config.ts` security headers).
- **Strong HTTP security headers:** `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, a broad
  `Permissions-Policy` deny-list, `Cross-Origin-Opener-Policy`, and a
  **Content-Security-Policy** locked to known script/connect origins
  (Supabase, Stripe, Plaid, Google Maps, Vercel).
- **Passwordless / WebAuthn passkeys** (Face ID / Touch ID) available.
- **Payment data never touches our servers** — Stripe-hosted checkout;
  bank links via Plaid. Card/bank credentials are out of scope by design.

> Items to **verify and document** (not asserting them here as fact):
> encryption at rest on the database, Supabase Row-Level-Security coverage
> on every table, least-privilege service-role key handling, centralized
> audit logging + retention, backup/restore testing, and access reviews.

---

## SOC 2 — the actual path

SOC 2 is an attestation report a **licensed CPA firm** issues against the
AICPA Trust Services Criteria (Security is mandatory; Availability,
Confidentiality, Processing Integrity, Privacy are optional add-ons).

1. **Scope & type.** Start with **Type I** (controls designed correctly at
   a point in time), then **Type II** (controls operating effectively over
   a 3–12 month window). Buyers ultimately want Type II.
2. **Pick a compliance platform** — Vanta, Drata, or Secureframe. They
   automate evidence collection (from Supabase, Vercel, GitHub, Google
   Workspace, etc.) and give you the policy templates.
3. **Write & adopt policies** (the human work): Information Security,
   Access Control, Incident Response, Change Management, Vendor Management,
   Business Continuity/DR, Data Classification, Acceptable Use, SDLC.
4. **Implement/close control gaps** the platform flags: MFA everywhere,
   background checks, onboarding/offboarding checklists, laptop MDM +
   disk encryption, centralized logging, vulnerability scanning,
   documented backups with restore tests.
5. **Engage an auditor** (the CPA firm — the platforms partner with
   several). They do the Type I, then the Type II observation period.
6. **Only then** publish "SOC 2 Type II" and share the report under NDA.

Rough cost: platform ~$7–25k/yr + auditor ~$10–40k/yr. Timeline: Type I in
~1–3 months of focused work; Type II report ~6–12 months out.

---

## ISO 27001 — the actual path

ISO 27001 certifies an **Information Security Management System (ISMS)** —
a documented, risk-driven management process — and is issued by an
**accredited certification body** (e.g., Schellman, BSI, A-LIGN).

1. **Define ISMS scope** and get management commitment.
2. **Risk assessment + treatment plan**; produce the **Statement of
   Applicability** against the Annex A controls.
3. **Operate the ISMS** — internal audits + a management review cycle.
4. **Stage 1 (documentation) then Stage 2 (implementation) audit** by the
   certification body → certificate (valid 3 years, annual surveillance).

The same compliance platforms (Vanta/Drata/Secureframe) map ~80% of the
evidence to both SOC 2 and ISO 27001, so run them together.

---

## Recommended sequence

1. **Skip HIPAA** (not applicable).
2. **Adopt a compliance platform now** (Vanta/Drata/Secureframe) — it gives
   you the policy templates + a live gap list against both SOC 2 and ISO.
3. **Close technical gaps** (the platform's checklist; much is already
   done here). Engineering can help with logging/audit-trail, backup
   restore tests, and RLS coverage proofs.
4. **SOC 2 Type I → Type II first** (US buyers ask for it most), then
   **ISO 27001** in parallel using the shared evidence.
5. **Publish claims only after each report/cert is issued** — and keep a
   `/security` trust page describing real practices (drafted for review,
   not auto-published).

## Where code can help (engineering backlog)

- [ ] Confirm + document DB encryption at rest and backup/restore drills.
- [ ] Prove RLS is enabled on every user-data table (automated test).
- [ ] Centralized, tamper-evident audit logging with defined retention.
- [ ] Automated dependency + container vulnerability scanning in CI.
- [ ] A reviewed, non-published `/security` trust page (real practices only).
