"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";

/**
 * Persist the user's filer-type choice and route accordingly.
 *
 *   w2       → /personal/forecast (no company; personal-only mode)
 *   business → /onboarding/new-company (existing wizard)
 */
export async function saveFilerType(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const raw = String(formData.get("filer_type") ?? "");
  const filerType: "w2" | "business" =
    raw === "w2" ? "w2" : "business";

  await admin
    .from("profiles")
    .update({ tax_filer_type: filerType })
    .eq("id", user.id);

  revalidatePath("/dashboard");
  redirect(filerType === "w2" ? "/personal/forecast" : "/onboarding/new-company");
}
