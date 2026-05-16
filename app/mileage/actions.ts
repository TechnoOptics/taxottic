"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";
import { tripDeductionCents } from "@/lib/mileage/deduction";
import type { Classification } from "@/lib/mileage/segmentation";

const ALLOWED: Classification[] = ["business", "personal", "unclassified"];

/**
 * Re-classify a trip (business / personal / unclassified) and
 * re-derive its IRS deduction. Allowed for the driver, or a
 * manager of the trip's company (the account-manager use case).
 * Write via the service-role client scoped to the validated
 * identity — the codebase's standard route/action pattern.
 */
export async function reclassifyTrip(formData: FormData) {
  const { user, admin } = await requireUserWithAdmin();
  const tripId = String(formData.get("trip_id") ?? "");
  const raw = String(formData.get("classification") ?? "");
  if (!tripId) throw new Error("Missing trip id.");
  if (!ALLOWED.includes(raw as Classification)) {
    throw new Error("Invalid classification.");
  }
  const classification = raw as Classification;

  const { data: trip } = await admin
    .from("mileage_trips")
    .select("id, company_id, driver_user_id, distance_miles, tax_year")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) throw new Error("Trip not found.");

  let authorized = trip.driver_user_id === user.id;
  if (!authorized) {
    const { data: mem } = await admin
      .from("company_members")
      .select("role")
      .eq("company_id", trip.company_id)
      .eq("user_id", user.id)
      .maybeSingle();
    authorized = mem?.role === "manager";
  }
  if (!authorized) {
    throw new Error("You can't re-classify this trip.");
  }

  const deductionCents = tripDeductionCents(
    { distanceMiles: Number(trip.distance_miles) },
    classification,
    Number(trip.tax_year),
  );

  const { error } = await admin
    .from("mileage_trips")
    .update({
      classification,
      classified_by: user.id,
      classified_at: new Date().toISOString(),
      deduction_cents: deductionCents,
    })
    .eq("id", tripId);
  if (error) throw new Error(error.message);

  revalidatePath("/mileage");
}
