"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";

/**
 * Record that the user acknowledged the forecast/estimate legal
 * disclaimer, then continue onboarding. One-shot, like saveFilerType:
 * once `tax_disclaimer_accepted_at` is set the dashboard gate stops
 * routing here. The "I understand" checkbox is required client-side
 * and re-checked here so a crafted POST can't skip the acknowledgement
 * (this is the line that protects us legally, keep it strict).
 */
export async function acceptTaxDisclaimer(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();

  const acknowledged = formData.get("acknowledge") === "1";
  if (!acknowledged) {
    redirect("/onboarding/disclaimer?error=Please%20check%20the%20box%20to%20continue");
  }

  await admin
    .from("profiles")
    .update({ tax_disclaimer_accepted_at: new Date().toISOString() })
    .eq("id", user.id);

  revalidatePath("/dashboard");
  redirect("/onboarding/filer-type");
}
