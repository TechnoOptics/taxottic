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

  const employeeCount = num("employee_count");
  const { error } = await admin.from("business_profiles").upsert({
    company_id: companyId,
    tax_year: taxYear,
    expected_revenue_cents: expectedCents,
    has_employees:
      formData.get("has_employees") === "on" ||
      (employeeCount !== null && employeeCount > 0),
    employee_count: employeeCount,
    has_vehicle: formData.get("has_vehicle") === "on",
    has_home_office: formData.get("has_home_office") === "on",
    home_office_sqft: num("home_office_sqft"),
    home_total_sqft: num("home_total_sqft"),
    vehicle_method: text("vehicle_method"),
    vehicle_business_miles: num("vehicle_business_miles"),
    primary_industry: text("primary_industry"),
    // Tax-export details
    legal_name: text("legal_name"),
    ein: text("ein"),
    address_line1: text("address_line1"),
    address_line2: text("address_line2"),
    city: text("city"),
    zip: text("zip"),
    phone: text("phone"),
    business_email: text("business_email"),
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

/**
 * Set or replace a company's logo URL. The actual upload to Supabase
 * Storage already happened on the client (RLS on the storage bucket
 * gates that to managers). This action only persists the resolved
 * public URL onto the row, after re-confirming the caller is a
 * manager so a stray POST can't smuggle a URL in.
 */
export async function setCompanyLogoUrl(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const logoUrl = String(formData.get("logo_url") ?? "").trim();

  if (!companyId || !logoUrl) throw new Error("Missing input");
  // Lightweight URL guard - we only accept https URLs from our
  // Supabase Storage host. Prevents a manager (or a stale form) from
  // setting an arbitrary external URL that could break print or leak
  // referrers.
  const supabaseHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host;
    } catch {
      return "";
    }
  })();
  try {
    const u = new URL(logoUrl);
    if (u.protocol !== "https:" || u.host !== supabaseHost) {
      throw new Error("Logo URL must be hosted on Supabase Storage.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Logo URL")) throw err;
    throw new Error("Invalid logo URL");
  }

  const { data: membership } = await admin
    .from("company_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (membership?.role !== "manager") {
    throw new Error("Only the company manager can change the logo.");
  }

  const { error } = await admin
    .from("companies")
    .update({ logo_url: logoUrl })
    .eq("id", companyId);
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/profile`);
    revalidatePath(`/c/${company.public_id}/forecast`);
    revalidatePath(`/c/${company.public_id}/export`);
    revalidatePath(`/dashboard`);
  }
}

/**
 * Clear the logo. We null the column AND best-effort delete every
 * object under the company's folder in storage so the file doesn't
 * linger paid-for-storage on the user's behalf.
 */
export async function clearCompanyLogo(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  if (!companyId) throw new Error("Missing input");

  const { data: membership } = await admin
    .from("company_members")
    .select("role")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (membership?.role !== "manager") {
    throw new Error("Only the company manager can change the logo.");
  }

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();

  if (company?.public_id) {
    // List + delete every object in this company's folder. List can
    // return up to 100 by default; that's plenty for "all the logos a
    // single company ever uploaded" (we only keep the latest).
    const { data: objs } = await admin.storage
      .from("company-logos")
      .list(company.public_id, { limit: 100 });
    if (objs && objs.length > 0) {
      await admin.storage
        .from("company-logos")
        .remove(objs.map((o) => `${company.public_id}/${o.name}`));
    }
  }

  const { error } = await admin
    .from("companies")
    .update({ logo_url: null })
    .eq("id", companyId);
  if (error) throw new Error(error.message);

  if (company) {
    revalidatePath(`/c/${company.public_id}/profile`);
    revalidatePath(`/c/${company.public_id}/forecast`);
    revalidatePath(`/c/${company.public_id}/export`);
    revalidatePath(`/dashboard`);
  }
}
