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

  revalidatePath("/mileage/classify");
  revalidatePath("/mileage");
  revalidatePath("/mileage/business");
}
