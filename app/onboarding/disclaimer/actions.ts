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

  const nowIso = new Date().toISOString();
  await admin
    .from("profiles")
    .update({
      tax_disclaimer_accepted_at: nowIso,
      // Item 13: fold GDPR consent into this single legal acknowledgement
      // so it isn't a separate banner (especially on mobile).
      gdpr_consented_at: nowIso,
    })
    .eq("id", user.id);

  revalidatePath("/dashboard");
  // Route through the dashboard gate, which sends invited members to their
  // company instead of the personal filer-type fork (item 13).
  redirect("/dashboard");
}
