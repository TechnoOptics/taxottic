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
  const ageRaw = formData.get("age");
  const age = ageRaw && String(ageRaw).trim() !== "" ? Number(ageRaw) : null;
  const isBlind = formData.get("is_blind") === "on";
  const itemize = formData.get("itemize") === "on";

  const spouseCents = parseDollarsToCents(
    String(formData.get("spouse_income") ?? ""),
  );
  const estPaymentsCents = parseDollarsToCents(
    String(formData.get("estimated_payments") ?? ""),
  );

  const { error } = await admin.from("tax_profiles").upsert({
    user_id: user.id,
    tax_year: taxYear,
    filing_status: filingStatus,
    state_code: stateCode,
    dependents,
    age,
    is_blind: isBlind,
    itemize,
    spouse_income_cents: spouseCents ?? 0,
    estimated_payments_cents: estPaymentsCents ?? 0,
  });

  if (error) throw new Error(error.message);

  redirect(next);
}
