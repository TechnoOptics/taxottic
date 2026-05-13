"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { parseDollarsToCents } from "@/lib/tax/forecast";

export async function addGoal(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const goalType = String(formData.get("goal_type") ?? "custom");
  const taxYear = Number(formData.get("tax_year"));
  const targetCents = parseDollarsToCents(
    String(formData.get("target_amount") ?? ""),
  );
  const deadlineRaw = String(formData.get("deadline") ?? "").trim();
  const deadline = deadlineRaw === "" ? null : deadlineRaw;
  const companyId = String(formData.get("company_id") ?? "").trim() || null;

  if (!title || !taxYear || targetCents === null || targetCents <= 0) {
    throw new Error("Invalid goal");
  }

  // If the goal is being attached to a company, the user must actually
  // be a member of that company. Without this check a user could pollute
  // another tenant's goal listing by passing an arbitrary company_id in
  // the form payload — write-only mis-attribution, not a read leak, but
  // it lets one user's goal show up under another company's UI.
  // Mirrors the membership gate in app/c/[publicId]/savings-goals/actions.ts.
  if (companyId) {
    const { data: m } = await admin
      .from("company_members")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!m) throw new Error("Not a member of this company");
  }

  const { error } = await admin.from("goals").insert({
    user_id: user.id,
    company_id: companyId,
    tax_year: taxYear,
    goal_type: goalType,
    title,
    target_cents: targetCents,
    deadline,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/goals");
  revalidatePath("/dashboard");
}

export async function deleteGoal(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await admin.from("goals").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/goals");
  revalidatePath("/dashboard");
}

export async function recordSaved(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const cents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  if (!id || cents === null || cents <= 0) return;

  const { data: g } = await admin
    .from("goals")
    .select("saved_cents, target_cents")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (!g) return;

  const newSaved = (g.saved_cents ?? 0) + cents;
  const status =
    g.target_cents > 0 && newSaved >= g.target_cents ? "completed" : "active";

  await admin
    .from("goals")
    .update({ saved_cents: newSaved, status })
    .eq("id", id)
    .eq("user_id", user.id);

  revalidatePath("/goals");
  revalidatePath("/dashboard");
}
