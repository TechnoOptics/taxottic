"use server";

import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";

export async function saveEmployeeRole(formData: FormData, next: string) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const title = String(formData.get("title") ?? "").trim() || null;
  const bio = String(formData.get("bio") ?? "").trim() || null;
  if (!companyId) throw new Error("Missing company");

  // Only update the calling user's own row.
  await admin
    .from("company_members")
    .update({
      title,
      bio,
      onboarded_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("user_id", user.id);

  redirect(next);
}
