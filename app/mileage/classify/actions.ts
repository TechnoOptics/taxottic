"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { reclassifyTripCore } from "@/lib/mileage/reclassify";

/**
 * Classify one mileage_trips row from the phone-side /mileage/classify
 * deck. Mirrors what /api/watch/confirm does from the watch swipe -
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

  // reclassifyTripCore RETURNS its failure, it does not throw
  // (lib/mileage/reclassify.ts), and this action used to discard the
  // return value and revalidate regardless. The deck then advanced to
  // the next card and, on the last one, pushed the driver to
  // "caught up". So a forbidden trip, a deleted trip, or a rejected
  // write produced a full swipe-through in which nothing was saved and
  // nothing was said. Mirrors the mapping in app/mileage/actions.ts so
  // the two entry points to the same core agree on what a refusal means.
  const res = await reclassifyTripCore(admin, user.id, id, classification);
  if (!res.ok) {
    throw new Error(
      res.reason === "forbidden"
        ? "You can't classify this drive."
        : res.reason === "not_found"
          ? "That drive is no longer here. Reload the page."
          : res.reason === "invalid"
            ? "Invalid classification."
            : "Couldn't save. Please try again.",
    );
  }

  // Every page that aggregates `mileage_trips`. Without these, the
  // /c/{id}/money-out "Miles driven" tile, the my-deductions YTD
  // mileage card, and the forecast scorecard's Vehicle line all
  // stay stale until their per-page cache TTL expires, exactly
  // the "doesn't update the other places" symptom the user hit.
  // Using the dynamic-route form so all publicId variants drop.
  revalidatePath("/mileage/classify");
  revalidatePath("/mileage");
  revalidatePath("/mileage/business");
  revalidatePath("/c/[publicId]/money-out", "page");
  revalidatePath("/c/[publicId]/my-deductions", "page");
  revalidatePath("/c/[publicId]/forecast", "page");
  revalidatePath("/c/[publicId]/savings-goals", "page");
  // The dashboard's outstanding-items bell/banner/popup all read the same
  // tally, without this, a classified trip kept showing there until the
  // page's own cache TTL expired, even though the classify deck itself
  // had already advanced past it.
  revalidatePath("/dashboard");
}
