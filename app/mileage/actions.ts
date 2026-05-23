"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { reclassifyTripCore } from "@/lib/mileage/reclassify";

/**
 * Re-classify a trip (business / personal / unclassified) and
 * re-derive its IRS deduction. Allowed for the driver, or a
 * manager of the trip's company (the account-manager use case).
 * Delegates to the shared core so this and the push action-handler
 * route stay in lockstep.
 */
export async function reclassifyTrip(formData: FormData) {
  const { user, admin } = await requireUserWithAdmin();
  const tripId = String(formData.get("trip_id") ?? "");
  const classification = String(formData.get("classification") ?? "");

  const res = await reclassifyTripCore(
    admin,
    user.id,
    tripId,
    classification,
  );
  if (!res.ok) {
    throw new Error(
      res.reason === "forbidden"
        ? "You can't re-classify this trip."
        : res.reason === "not_found"
          ? "Trip not found."
          : res.reason === "invalid"
            ? "Invalid classification."
            : "Couldn't save. Please try again.",
    );
  }

  // Mirror the broader fan-out used by /mileage/classify so a flip
  // here updates every aggregator (money-out tile, my-deductions
  // YTD, forecast scorecard, savings goals) and not just /mileage.
  revalidatePath("/mileage");
  revalidatePath("/mileage/classify");
  revalidatePath("/mileage/business");
  revalidatePath("/c/[publicId]/money-out", "page");
  revalidatePath("/c/[publicId]/my-deductions", "page");
  revalidatePath("/c/[publicId]/forecast", "page");
  revalidatePath("/c/[publicId]/savings-goals", "page");
}
