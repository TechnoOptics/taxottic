"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { parseDollarsToCents } from "@/lib/tax/forecast";

export async function saveBusinessProfile(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const taxYear = Number(formData.get("tax_year"));
  if (!companyId || !taxYear) throw new Error("Invalid input");

  // Manager-only: verify before write.
  const { data: membership } = await admin
    .from("company_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (membership?.role !== "manager") {
    throw new Error("Only the company manager can edit the business profile.");
  }

  const expectedCents = parseDollarsToCents(
    String(formData.get("expected_revenue") ?? ""),
  );

  const num = (key: string) => {
    const raw = formData.get(key);
    if (raw === null || String(raw).trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const text = (key: string) => {
    const raw = String(formData.get(key) ?? "").trim();
    return raw === "" ? null : raw;
  };

  const { error } = await admin.from("business_profiles").upsert({
    company_id: companyId,
    tax_year: taxYear,
    expected_revenue_cents: expectedCents,
    has_employees: formData.get("has_employees") === "on",
    has_vehicle: formData.get("has_vehicle") === "on",
    has_home_office: formData.get("has_home_office") === "on",
    home_office_sqft: num("home_office_sqft"),
    home_total_sqft: num("home_total_sqft"),
    vehicle_method: text("vehicle_method"),
    vehicle_business_miles: num("vehicle_business_miles"),
    primary_industry: text("primary_industry"),
  });
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/profile`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}
