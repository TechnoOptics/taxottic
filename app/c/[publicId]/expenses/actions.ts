"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parseDollarsToCents } from "@/lib/tax/forecast";

export async function addExpense(formData: FormData) {
  const { supabase, user } = await requireUser();
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

  const { error } = await supabase.from("monthly_expenses").insert({
    company_id: companyId,
    user_id: user.id,
    tax_year: taxYear,
    month,
    amount_cents: cents,
    category_code: categoryCode,
    notes,
  });
  if (error) throw new Error(error.message);

  const { data: company } = await supabase
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
  const { supabase } = await requireUser();
  const companyId = String(formData.get("company_id") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { error } = await supabase
    .from("monthly_expenses")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);

  const { data: company } = await supabase
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/expenses`);
    revalidatePath(`/c/${company.public_id}/forecast`);
  }
}
