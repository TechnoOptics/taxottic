"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { reclassifyTripCore } from "@/lib/mileage/reclassify";
import { tripDeductionCents } from "@/lib/mileage/deduction";

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

/**
 * Permanently delete a trip + its mileage_points. Allowed for the
 * driver or a manager of the trip's company. Points cascade on
 * trip delete (FK ON DELETE CASCADE in the migration), so this is
 * a single DELETE against mileage_trips guarded by the same auth
 * gate as reclassify. Same revalidate fan-out so every aggregator
 * drops the row from its totals.
 */
export async function deleteTrip(formData: FormData) {
  const { user, admin } = await requireUserWithAdmin();
  const tripId = String(formData.get("trip_id") ?? "");
  if (!tripId) return;

  const { data: trip } = await admin
    .from("mileage_trips")
    .select("driver_user_id, company_id")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) return;

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
    throw new Error("You can't delete this trip.");
  }

  await admin.from("mileage_trips").delete().eq("id", tripId);

  revalidatePath("/mileage");
  revalidatePath("/mileage/classify");
  revalidatePath("/mileage/business");
  revalidatePath("/c/[publicId]/money-out", "page");
  revalidatePath("/c/[publicId]/my-deductions", "page");
  revalidatePath("/c/[publicId]/forecast", "page");
  revalidatePath("/c/[publicId]/savings-goals", "page");
}

/**
 * Manual drive entry — the backfill option when the tracker missed
 * a drive (no GPS captured, app was killed, schedule blocked, etc).
 * Required because GPS background capture is best-effort on Android
 * and a user who's been on a real drive deserves a "log it
 * yourself" escape hatch instead of losing the deduction.
 *
 * Form fields:
 *   started_at_local   "YYYY-MM-DDTHH:MM" datetime-local input value
 *   ended_at_local     same shape
 *   distance_miles     numeric, max 1 decimal
 *   classification     "business" | "personal" | "unclassified"
 *
 * The two datetime-local values arrive in the user's LOCAL clock
 * (no zone suffix). `new Date(...)` parses them in the SERVER's
 * timezone, which would shift hours on a UTC server. To preserve
 * the user's wall-clock intent we accept those local strings as-is
 * and explicitly mark them as having a local offset before storing.
 * Detailed comment inline at the parse site.
 */
export async function addManualTrip(formData: FormData) {
  const { user, admin } = await requireUserWithAdmin();
  const memberships = await getMyCompanies();
  const companyId = memberships[0]?.company?.id;
  if (!companyId) throw new Error("Join a company before logging miles.");

  const startedLocal = String(formData.get("started_at_local") ?? "");
  const endedLocal = String(formData.get("ended_at_local") ?? "");
  const miles = Number(formData.get("distance_miles") ?? 0);
  const classification = String(formData.get("classification") ?? "unclassified");
  const tzOffsetMin = Number(formData.get("tz_offset_min") ?? 0);

  if (!startedLocal || !endedLocal) {
    throw new Error("Pick a start and an end time.");
  }
  if (!Number.isFinite(miles) || miles <= 0 || miles > 9_999) {
    throw new Error("Enter a positive mileage under 9,999.");
  }
  if (
    classification !== "business" &&
    classification !== "personal" &&
    classification !== "unclassified"
  ) {
    throw new Error("Invalid classification.");
  }

  // Reconstruct the user's wall-clock instant. `datetime-local`
  // values are naive (no zone). The form sends the browser's
  // current `Date.prototype.getTimezoneOffset()` so we can apply it
  // here and end up with the correct UTC instant regardless of
  // where the Vercel runtime is. (Offset is in MINUTES, +negative
  // east of UTC per JS convention; subtracting it yields UTC ms.)
  const startedLocalMs = Date.parse(startedLocal + ":00");
  const endedLocalMs = Date.parse(endedLocal + ":00");
  if (!Number.isFinite(startedLocalMs) || !Number.isFinite(endedLocalMs)) {
    throw new Error("Couldn't parse the dates.");
  }
  const startedAt = new Date(startedLocalMs + tzOffsetMin * 60_000).toISOString();
  const endedAt = new Date(endedLocalMs + tzOffsetMin * 60_000).toISOString();
  if (new Date(endedAt) <= new Date(startedAt)) {
    throw new Error("End time must be after start time.");
  }

  const taxYear = new Date(startedAt).getUTCFullYear();
  const cls = classification as "business" | "personal" | "unclassified";
  const deductionCents = tripDeductionCents(
    { distanceMiles: miles },
    cls,
    taxYear,
  );

  const { error } = await admin.from("mileage_trips").insert({
    company_id: companyId,
    driver_user_id: user.id,
    started_at: startedAt,
    ended_at: endedAt,
    distance_miles: Number(miles.toFixed(3)),
    classification: cls,
    tax_year: taxYear,
    deduction_cents: deductionCents,
    notes: "manual entry",
  });
  if (error) throw new Error("Couldn't save. Please try again.");

  revalidatePath("/mileage");
  revalidatePath("/mileage/classify");
  revalidatePath("/mileage/business");
  revalidatePath("/c/[publicId]/money-out", "page");
  revalidatePath("/c/[publicId]/my-deductions", "page");
  revalidatePath("/c/[publicId]/forecast", "page");
  revalidatePath("/c/[publicId]/savings-goals", "page");
}
