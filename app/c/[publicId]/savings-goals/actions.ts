"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";

/**
 * Adopt a tax-savings goal, copy the recommendation into the user's
 * goals table so it shows up on /goals and the dashboard. Idempotent:
 * if the user has already adopted this goal_id for the same tax year,
 * we no-op and redirect to /goals.
 */
export async function adoptSavingsGoal(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const goalId = String(formData.get("goal_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  const taxYear = Number(formData.get("tax_year"));
  const title = String(formData.get("title") ?? "").slice(0, 200);
  const targetCents = Number(formData.get("target_cents") ?? 0);
  const deadline = String(formData.get("deadline") ?? "");

  if (!goalId || !companyId || !taxYear || !title || !targetCents) {
    throw new Error("Missing required goal fields");
  }
  // Verify the user is in this company.
  const { data: m } = await admin
    .from("company_members")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!m) throw new Error("Not a member of this company");

  // Idempotency: if a goal with this title already exists for the
  // same user + company + year, do nothing.
  const { data: existing } = await admin
    .from("goals")
    .select("id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .eq("tax_year", taxYear)
    .eq("title", title)
    .maybeSingle();
  if (!existing) {
    await admin.from("goals").insert({
      user_id: user.id,
      company_id: companyId,
      tax_year: taxYear,
      goal_type: "deduction_capture",
      title,
      target_cents: targetCents,
      saved_cents: 0,
      deadline: deadline || null,
      status: "active",
    });
  }

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  revalidatePath(`/c/${company?.public_id}/savings-goals`);
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  redirect("/goals");
}
