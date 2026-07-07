"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";

/**
 * Apply an annualized pay-stub read to the user's tax profile — the
 * three fields that drive the personal forecast's W-2 side:
 *
 *   owner_w2_wages_cents     (Box-1 equivalent: gross − pre-tax)
 *   owner_w2_withheld_cents  (annualized federal withholding)
 *   owner_w2_ss_wages_cents  (gross − §125 health − payroll HSA)
 *
 * Deliberately does NOT write hsa_contribution_cents: a payroll HSA is
 * already excluded from the Box-1 wages above, so recording it again
 * as a deduction would double-count the tax benefit.
 *
 * Only runs against an EXISTING profile row (the page redirects to
 * onboarding when there is none), so filing status et al. stay exactly
 * what the user chose — this action touches income fields only.
 */
export async function applyPaystubAnnualization(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const taxYear = new Date().getUTCFullYear();

  const cents = (key: string): number => {
    const n = Number(formData.get(key));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };
  const wages = cents("annual_box1_cents");
  const withheld = cents("annual_withheld_cents");
  const ssWages = cents("annual_ss_cents");
  const stateRaw = String(formData.get("state_code") ?? "").toUpperCase();
  const stateCode = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;

  if (wages <= 0) throw new Error("Nothing to apply — wages missing.");

  const { data: existing } = await admin
    .from("tax_profiles")
    .select("user_id, state_code")
    .eq("user_id", user.id)
    .eq("tax_year", taxYear)
    .maybeSingle();
  if (!existing) {
    redirect("/onboarding/tax-profile?next=/personal/paystub");
  }

  const patch: Record<string, unknown> = {
    owner_w2_wages_cents: wages,
    owner_w2_withheld_cents: withheld,
    owner_w2_ss_wages_cents: ssWages,
  };
  // Fill the state only when the profile doesn't have one yet — the
  // stub's state-tax line is a hint, never an override.
  if (stateCode && !existing.state_code) patch.state_code = stateCode;

  const { error } = await admin
    .from("tax_profiles")
    .update(patch)
    .eq("user_id", user.id)
    .eq("tax_year", taxYear);
  if (error) throw new Error(error.message);

  revalidatePath("/personal/forecast");
  revalidatePath("/dashboard");
  redirect("/personal/forecast");
}
