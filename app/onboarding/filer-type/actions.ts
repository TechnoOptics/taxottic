"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";

/**
 * Persist the user's filer-type choice and route accordingly.
 *
 * The page is two checkboxes ('w2' and/or 'business'); we map the
 * combined selection to the three legal values of
 * profiles.tax_filer_type:
 *
 *   ['w2']              → 'w2'        → /personal/forecast
 *   ['business']        → 'business'  → /onboarding/new-company
 *   ['w2', 'business']  → 'both'      → /onboarding/new-company
 *   []                  → reject; nothing was picked.
 *
 * 'both' users land on the company-creation flow because they need a
 * company before the business side has anything to forecast against.
 * Once the company exists, the dashboard surfaces both the personal
 * forecast (their W-2 side) and the company forecast (their SE side),
 * and the combined refund-or-owe story falls out of the math.
 */
export async function saveFilerType(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();

  // FormData.getAll returns every value posted under the name. With
  // two checkboxes both checked, this returns both values; with one
  // checked, just that one; with none, an empty array.
  const picks = new Set(
    formData
      .getAll("filer_type")
      .map((v) => String(v))
      .filter((v) => v === "w2" || v === "business"),
  );

  let filerType: "w2" | "business" | "both";
  if (picks.has("w2") && picks.has("business")) {
    filerType = "both";
  } else if (picks.has("w2")) {
    filerType = "w2";
  } else if (picks.has("business")) {
    filerType = "business";
  } else {
    // Nothing picked - bounce back. Keeping this as a redirect rather
    // than a thrown error so the user just sees the form again with
    // an inline message (which the page can wire up via ?error= if we
    // want the affordance later).
    redirect("/onboarding/filer-type?error=Pick%20at%20least%20one");
  }

  await admin
    .from("profiles")
    .update({ tax_filer_type: filerType })
    .eq("id", user.id);

  revalidatePath("/dashboard");
  redirect(
    filerType === "w2"
      ? "/personal/forecast"
      : "/onboarding/new-company",
  );
}
