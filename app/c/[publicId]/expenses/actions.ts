"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { parseDollarsToCents } from "@/lib/tax/forecast";

async function userBelongsToCompany(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  userId: string,
  companyId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("company_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  return !!data;
}

export async function addExpense(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const taxYear = Number(formData.get("tax_year"));
  const month = Number(formData.get("month"));
  const categoryCode = String(formData.get("category_code") ?? "");
  const cents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (
    !companyId ||
    !taxYear ||
    !month ||
    !categoryCode ||
    cents === null ||
    cents <= 0
  ) {
    throw new Error("Invalid input");
  }
  // Reject future-dated entries and entries from other tax years.
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (taxYear !== currentYear) {
    throw new Error("You can only add entries for the current tax year.");
  }
  if (month < 1 || month > 12 || month > currentMonth) {
    throw new Error("You cannot add entries for a future month.");
  }
  if (!(await userBelongsToCompany(admin, user.id, companyId))) {
    throw new Error("Not a member of this company");
  }

  const { error } = await admin.from("monthly_expenses").insert({
    company_id: companyId,
    user_id: user.id,
    tax_year: taxYear,
    month,
    amount_cents: cents,
    category_code: categoryCode,
    notes,
  });
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/expenses`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}

export async function deleteExpense(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { error } = await admin
    .from("monthly_expenses")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/expenses`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}
