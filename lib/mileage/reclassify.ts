// Shared trip-reclassification core. Single source of truth used by
// BOTH the /mileage server action and the push action-handler route,
// so a "Business / Personal" tap from a notification takes the exact
// same authorised, deduction-recomputing path as the in-app button.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { tripDeductionCents } from "./deduction";
import type { Classification } from "./segmentation";

export const RECLASSIFY_ALLOWED: Classification[] = [
  "business",
  "personal",
  "unclassified",
];

export type ReclassifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "not_found" | "forbidden" | "db" };

/**
 * Authorise (the driver, or a manager of the trip's company),
 * recompute the IRS deduction for the new classification, and
 * persist. `admin` is the service-role client; `userId` is the
 * already-validated caller. Returns a discriminated result rather
 * than throwing so HTTP callers can map cleanly to status codes.
 */
export async function reclassifyTripCore(
  admin: any,
  userId: string,
  tripId: string,
  classification: string,
): Promise<ReclassifyResult> {
  if (!tripId) return { ok: false, reason: "invalid" };
  if (!RECLASSIFY_ALLOWED.includes(classification as Classification)) {
    return { ok: false, reason: "invalid" };
  }
  const cls = classification as Classification;

  const { data: trip } = await admin
    .from("mileage_trips")
    .select("id, company_id, driver_user_id, distance_miles, tax_year, started_at")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) return { ok: false, reason: "not_found" };

  let authorized = trip.driver_user_id === userId;
  if (!authorized) {
    const { data: mem } = await admin
      .from("company_members")
      .select("role")
      .eq("company_id", trip.company_id)
      .eq("user_id", userId)
      .maybeSingle();
    authorized = mem?.role === "manager";
  }
  if (!authorized) return { ok: false, reason: "forbidden" };

  const deductionCents = tripDeductionCents(
    { distanceMiles: Number(trip.distance_miles) },
    cls,
    Number(trip.tax_year),
    trip.started_at as string,
  );

  const { error } = await admin
    .from("mileage_trips")
    .update({
      classification: cls,
      classified_by: userId,
      classified_at: new Date().toISOString(),
      // A human has now decided, so the drive is no longer an assumption:
      // clear the flag and write the real deduction. This is also what
      // makes the "Confirm" tap on /mileage work by re-sending the drive's
      // CURRENT classification. Every surface routes through here (the
      // trip list, the swipe deck, the push action, the watch), so one
      // write covers them all, and finalize's re-render path reads the
      // cleared flag and can never zero the deduction again.
      needs_confirmation: false,
      deduction_cents: deductionCents,
    })
    .eq("id", tripId);
  if (error) return { ok: false, reason: "db" };

  return { ok: true };
}
