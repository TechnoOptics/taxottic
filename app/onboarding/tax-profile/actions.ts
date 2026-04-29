"use server";

import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { parseDollarsToCents } from "@/lib/tax/forecast";

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

  const dollar = (key: string): number =>
    parseDollarsToCents(String(formData.get(key) ?? "")) ?? 0;

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
  });

  if (error) throw new Error(error.message);

  redirect(next);
}
