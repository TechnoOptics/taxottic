"use server";

import { revalidatePath } from "next/cache";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";

/**
 * Apply (or update) the Home Office deduction for the current tax
 * year. UPSERTs into business_profiles keyed on (company_id, tax_year)
 * and flips has_home_office to true. The forecast pipeline already
 * picks up the flag + sqft and computes Form 8829.
 *
 * Manager/owner check happens inside loadCompanyByPublicId via the
 * standard company-membership policy.
 */
export async function applyHomeOffice(formData: FormData) {
  const publicId = String(formData.get("publicId") ?? "");
  if (!publicId) throw new Error("missing publicId");

  const sqftRaw = String(formData.get("home_office_sqft") ?? "");
  const totalRaw = String(formData.get("home_total_sqft") ?? "");
  const sqft = Number.parseInt(sqftRaw, 10);
  const total = Number.parseInt(totalRaw, 10);

  // Basic sanity: positive integers, office can't be bigger than the
  // whole home. The IRS simplified-method cap is 300 sq ft, but the
  // regular method has no cap (just business-use % can't exceed 100).
  // We don't enforce the 300-cap here; the forecaster handles method
  // selection downstream and the user can pick simplified or actual.
  if (!Number.isFinite(sqft) || sqft <= 0) throw new Error("Office sq ft is required");
  if (!Number.isFinite(total) || total <= 0) throw new Error("Total home sq ft is required");
  if (sqft > total) throw new Error("Office can't be bigger than the total home");

  const { supabase, company } = await loadCompanyByPublicId(publicId);
  const taxYear = new Date().getUTCFullYear();

  // UPSERT on the composite key (company_id, tax_year). business_profiles
  // is rls-scoped via company_members so this fails for non-members.
  const { error } = await supabase.from("business_profiles").upsert(
    {
      company_id: company.id,
      tax_year: taxYear,
      has_home_office: true,
      home_office_sqft: sqft,
      home_total_sqft: total,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,tax_year" },
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/c/${publicId}/deductions`);
  revalidatePath(`/c/${publicId}/profile`);
  revalidatePath(`/c/${publicId}/forecast`);
}

/**
 * Remove the Home Office claim. Keeps the sqft on file (user might
 * re-enable next year) but flips has_home_office back to false so the
 * forecast stops including the 8829 deduction.
 */
export async function unapplyHomeOffice(formData: FormData) {
  const publicId = String(formData.get("publicId") ?? "");
  if (!publicId) throw new Error("missing publicId");

  const { supabase, company } = await loadCompanyByPublicId(publicId);
  const taxYear = new Date().getUTCFullYear();

  const { error } = await supabase
    .from("business_profiles")
    .update({
      has_home_office: false,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", company.id)
    .eq("tax_year", taxYear);
  if (error) throw new Error(error.message);

  revalidatePath(`/c/${publicId}/deductions`);
  revalidatePath(`/c/${publicId}/profile`);
  revalidatePath(`/c/${publicId}/forecast`);
}
