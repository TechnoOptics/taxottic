"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { reclassifyTripCore } from "@/lib/mileage/reclassify";

/**
 * Classify one mileage_trips row from the phone-side /mileage/classify
 * deck. Mirrors what /api/watch/confirm does from the watch swipe —
 * same core fn, same authorization gate.
 *
 * Form fields:
 *   id            uuid of the trip
 *   classification "business" | "personal"
 */
export async function classifyTrip(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const id = String(formData.get("id") ?? "");
  const classification = String(formData.get("classification") ?? "");

  if (!id || !classification) return;

  await reclassifyTripCore(admin, user.id, id, classification);

  // Every page that aggregates `mileage_trips`. Without these, the
  // /c/{id}/money-out "Miles driven" tile, the my-deductions YTD
  // mileage card, and the forecast scorecard's Vehicle line all
  // stay stale until their per-page cache TTL expires — exactly
  // the "doesn't update the other places" symptom the user hit.
  // Using the dynamic-route form so all publicId variants drop.
  revalidatePath("/mileage/classify");
  revalidatePath("/mileage");
  revalidatePath("/mileage/business");
  revalidatePath("/c/[publicId]/money-out", "page");
  revalidatePath("/c/[publicId]/my-deductions", "page");
  revalidatePath("/c/[publicId]/forecast", "page");
  revalidatePath("/c/[publicId]/savings-goals", "page");
}
