"use server";

import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { parseDollarsToCents } from "@/lib/tax/forecast";

/**
 * Persist a tax profile + every structured benefit input the forecast
 * engine knows how to apply. Every dollar field is optional and
 * defaults to 0 / null so a returning user who only fills part of the
 * form doesn't blow away the rest of their data.
 *
 * The new structured fields (retirement contributions, SE health,
 * LTCG / qualified dividends, foreign earned income, student loan
 * interest, education expenses, itemized sub-types, § 179, energy
 * credits, PTC advance) were added in migration
 * 20260512000001_tax_profile_benefit_fields.sql. Engine math wired
 * in lib/tax/forecast.ts. See docs/irs-2026-changes.md for the
 * per-item status table.
 */
export async function saveTaxProfile(formData: FormData, next: string) {
  const { admin, user } = await requireUserWithAdmin();

  const taxYear = Number(formData.get("tax_year"));
  const filingStatus = String(formData.get("filing_status") ?? "single");
  const stateCode = String(formData.get("state_code") ?? "")
    .trim()
    .toUpperCase()
    || null;
  const dependents = Number(formData.get("dependents") ?? 0);
  const dependentsUnder17Raw = Number(formData.get("dependents_under_17") ?? 0);
  // Clamp dependents_under_17 to dependents - the DB has a check constraint
  // and we'd rather silently fix bad input than throw a 500 at the user.
  const dependentsUnder17 = Math.max(
    0,
    Math.min(dependentsUnder17Raw, dependents),
  );
  const ageRaw = formData.get("age");
  const age = ageRaw && String(ageRaw).trim() !== "" ? Number(ageRaw) : null;
  const isBlind = formData.get("is_blind") === "on";
  const itemize = formData.get("itemize") === "on";
  const claimAotc = formData.get("claim_aotc") === "on";

  const dollar = (key: string): number =>
    parseDollarsToCents(String(formData.get(key) ?? "")) ?? 0;
  // Nullable variant for the itemized sub-types: if the user leaves a
  // sub-type field empty we want NULL (meaning "not broken out") rather
  // than 0 (which would imply "you genuinely paid zero SALT").
  const dollarOrNull = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "") return null;
    const parsed = parseDollarsToCents(raw);
    return parsed ?? null;
  };

  const { error } = await admin.from("tax_profiles").upsert({
    user_id: user.id,
    tax_year: taxYear,
    filing_status: filingStatus,
    state_code: stateCode,
    dependents,
    dependents_under_17: dependentsUnder17,
    age,
    is_blind: isBlind,
    itemize,
    // Owner W-2
    owner_w2_wages_cents: dollar("owner_w2_wages"),
    owner_w2_withheld_cents: dollar("owner_w2_withheld"),
    owner_w2_ss_wages_cents: dollar("owner_w2_ss_wages"),
    // Spouse W-2 (and keep the legacy spouse_income_cents in sync as
    // best-effort for older code paths still reading it)
    spouse_w2_wages_cents: dollar("spouse_w2_wages"),
    spouse_w2_withheld_cents: dollar("spouse_w2_withheld"),
    spouse_w2_ss_wages_cents: dollar("spouse_w2_ss_wages"),
    spouse_income_cents: dollar("spouse_w2_wages"),
    // Itemized total (only used if itemize=true, but stored either way so
    // toggling is reversible).
    itemized_total_cents: dollar("itemized_total"),
    estimated_payments_cents: dollar("estimated_payments"),

    // ---------- Item #1: Retirement contributions ----------
    solo_401k_contribution_cents: dollar("solo_401k_contribution"),
    sep_ira_contribution_cents: dollar("sep_ira_contribution"),
    traditional_ira_contribution_cents: dollar(
      "traditional_ira_contribution",
    ),
    roth_ira_contribution_cents: dollar("roth_ira_contribution"),
    hsa_contribution_cents: dollar("hsa_contribution"),

    // ---------- Item #2: Self-employed health insurance ----------
    se_health_insurance_cents: dollar("se_health_insurance"),

    // ---------- Item #4: Capital gains + qualified dividends ----------
    long_term_capital_gains_cents: dollar("long_term_capital_gains"),
    qualified_dividends_cents: dollar("qualified_dividends"),

    // ---------- Item #5: Itemized sub-types ----------
    // Null when not provided so we can distinguish "didn't fill this in"
    // from "deliberately reported zero" - the latter is rare for SALT
    // (everyone pays at least property tax) but the convention keeps
    // the data clean.
    itemized_salt_cents: dollarOrNull("itemized_salt"),
    itemized_mortgage_interest_cents: dollarOrNull(
      "itemized_mortgage_interest",
    ),
    itemized_charity_cents: dollarOrNull("itemized_charity"),
    itemized_medical_cents: dollarOrNull("itemized_medical"),

    // ---------- Item #6: Student loan + education ----------
    student_loan_interest_cents: dollar("student_loan_interest"),
    qualified_education_expenses_cents: dollar(
      "qualified_education_expenses",
    ),
    // claim_aotc lives next to the dollar amount because the engine
    // needs to know which credit to compute. Stored as a boolean
    // column added in the next migration.
    claim_aotc: claimAotc,

    // ---------- Item #7: § 179 expensing election ----------
    section_179_expense_cents: dollar("section_179_expense"),

    // ---------- Item #11: Foreign earned income ----------
    foreign_earned_income_cents: dollar("foreign_earned_income"),

    // ---------- Item #12: Energy + EV credits ----------
    residential_energy_credit_cents: dollar("residential_energy_credit"),
    ev_credit_cents: dollar("ev_credit"),

    // ---------- Item #9: PTC advance payments ----------
    ptc_advance_payments_cents: dollar("ptc_advance_payments"),
  });

  if (error) throw new Error(error.message);

  redirect(next);
}
