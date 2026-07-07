"use server";

import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";

/**
 * Adopt a PERSONAL tax-savings goal: copy the recommendation into the
 * user's goals table (company_id NULL — this is the individual side,
 * fully independent of any business) so it shows on /goals and the
 * dashboard. Idempotent per user + tax year + title.
 *
 * Mirrors the company-side adoptSavingsGoal
 * (app/c/[publicId]/savings-goals/actions.ts) minus the membership
 * check — a personal goal needs no company at all.
 */
export async function adoptPersonalSavingsGoal(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const goalId = String(formData.get("goal_id") ?? "");
  const taxYear = Number(formData.get("tax_year"));
  const title = String(formData.get("title") ?? "").slice(0, 200);
  const targetCents = Number(formData.get("target_cents") ?? 0);
  const deadline = String(formData.get("deadline") ?? "");

  if (!goalId || !taxYear || !title || !targetCents) {
    throw new Error("Missing required goal fields");
  }

  const { data: existing } = await admin
    .from("goals")
    .select("id")
    .eq("user_id", user.id)
    .is("company_id", null)
    .eq("tax_year", taxYear)
    .eq("title", title)
    .maybeSingle();
  if (!existing) {
    await admin.from("goals").insert({
      user_id: user.id,
      company_id: null,
      tax_year: taxYear,
      goal_type: "deduction_capture",
      title,
      target_cents: targetCents,
      saved_cents: 0,
      deadline: deadline || null,
      status: "active",
    });
  }

  redirect("/goals");
}
