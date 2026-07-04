"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { reclassifyTripCore } from "@/lib/mileage/reclassify";
import { tripDeductionCents } from "@/lib/mileage/deduction";
import { logCompanyActivity } from "@/lib/activity/log";
import { reconstructApproximateTrips } from "@/lib/mileage/reconstruct";
import { notify } from "@/lib/push";

/**
 * Recover approximate drives from the caller's degraded staging pool (see
 * lib/mileage/reconstruct). Opt-in via the tracking-health banner. Scoped
 * to the caller's OWN drives + their active company. Creates unclassified,
 * flagged-approximate trips (no deduction until reviewed).
 */
export async function recoverApproximateTrips() {
  const { user, admin } = await requireUserWithAdmin();
  const memberships = await getMyCompanies();
  const companyId = memberships[0]?.company?.id;
  if (!companyId) throw new Error("No company to recover drives for.");

  const sinceIso = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const created = await reconstructApproximateTrips(
    admin,
    user.id,
    companyId,
    sinceIso,
  );

  if (created > 0) {
    await logCompanyActivity(admin, {
      companyId,
      actorUserId: user.id,
      kind: "mileage.added",
      summary: `Recovered ${created} approximate drive${created === 1 ? "" : "s"} after a tracking gap (unclassified, needs review)`,
      payload: { created, approximate: true },
    });
  }

  revalidatePath("/mileage");
  revalidatePath("/mileage/classify");
}

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

  // Log against the trip's company (re-read for the company_id + label).
  const { data: t } = await admin
    .from("mileage_trips")
    .select("company_id, distance_miles")
    .eq("id", tripId)
    .maybeSingle();
  if (t?.company_id) {
    await logCompanyActivity(admin, {
      companyId: t.company_id,
      actorUserId: user.id,
      kind: "mileage.classified",
      summary: `Reclassified a ${Number(t.distance_miles ?? 0).toFixed(1)}-mile trip as ${classification}`,
      payload: { trip_id: tripId, classification },
    });
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
 * Move a trip to a DIFFERENT business (company). For users who belong
 * to more than one company and need to route a drive to the right one
 * (the tracker captures to whichever company was active at the time).
 *
 * Auth: the caller must be the driver OR a manager of the trip's
 * CURRENT company, AND a member of the TARGET company, you can't shove
 * a drive into a business you don't belong to. The IRS deduction is
 * rate-based and company-independent, so only company_id changes; the
 * classification, distance, and deduction carry over untouched.
 */
export async function moveTripCompany(formData: FormData) {
  const { user, admin } = await requireUserWithAdmin();
  const tripId = String(formData.get("trip_id") ?? "");
  const targetCompanyId = String(formData.get("company_id") ?? "");
  if (!tripId || !targetCompanyId) return;

  const { data: trip } = await admin
    .from("mileage_trips")
    .select("driver_user_id, company_id")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) throw new Error("Trip not found.");
  if (trip.company_id === targetCompanyId) return; // no-op

  // Authorized on the SOURCE: driver, or a manager of the source company.
  let authorized = trip.driver_user_id === user.id;
  if (!authorized) {
    const { data: srcMem } = await admin
      .from("company_members")
      .select("role")
      .eq("company_id", trip.company_id)
      .eq("user_id", user.id)
      .maybeSingle();
    authorized = srcMem?.role === "manager";
  }
  if (!authorized) throw new Error("You can't move this trip.");

  // Must be a member of the TARGET company.
  const { data: dstMem } = await admin
    .from("company_members")
    .select("role")
    .eq("company_id", targetCompanyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!dstMem) throw new Error("You're not a member of that business.");

  const { error } = await admin
    .from("mileage_trips")
    .update({ company_id: targetCompanyId })
    .eq("id", tripId);
  if (error) throw new Error("Couldn't move the trip. Please try again.");

  await logCompanyActivity(admin, {
    companyId: targetCompanyId,
    actorUserId: user.id,
    kind: "mileage.moved",
    summary: "Moved a mileage trip into this business",
    payload: { trip_id: tripId, from_company_id: trip.company_id },
  });

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
    .select("driver_user_id, company_id, distance_miles")
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

  await logCompanyActivity(admin, {
    companyId: trip.company_id,
    actorUserId: user.id,
    kind: "mileage.deleted",
    summary: `Deleted a ${Number(trip.distance_miles ?? 0).toFixed(1)}-mile trip`,
    payload: { trip_id: tripId },
  });

  revalidatePath("/mileage");
  revalidatePath("/mileage/classify");
  revalidatePath("/mileage/business");
  revalidatePath("/c/[publicId]/money-out", "page");
  revalidatePath("/c/[publicId]/my-deductions", "page");
  revalidatePath("/c/[publicId]/forecast", "page");
  revalidatePath("/c/[publicId]/savings-goals", "page");
}

/**
 * Route-reconstructed drive, the "my phone died mid-drive" recovery path.
 *
 * When the tracker misses a long drive (phone died, background location
 * killed, no signal on a road trip), the driver enters where they actually
 * went, start, destination, and any stops in between, and the client
 * computes the driving distance with the Google Directions service (road
 * miles, not straight-line) plus the route polyline. This action just
 * persists that: the trip + its path points. It's the honest, IRS-defensible
 * fallback (a written record of the route driven) so a dead battery never
 * costs the deduction.
 *
 * Form fields (all from the client after it computed the route):
 *   started_at_local / ended_at_local  "YYYY-MM-DDTHH:MM"
 *   tz_offset_min                       browser offset (see addManualTrip)
 *   distance_miles                      route distance (user may have edited)
 *   classification                      business | personal | unclassified
 *   method                              "directions" | "straight_line"
 *   stops_summary                       "A → B → C" for the note/audit trail
 *   path                                JSON [{lat,lng}, …] route polyline
 */
export async function addRouteTrip(formData: FormData) {
  const { user, admin } = await requireUserWithAdmin();
  const memberships = await getMyCompanies();
  const companyId = memberships[0]?.company?.id;
  if (!companyId) throw new Error("Join a company before logging miles.");

  const startedLocal = String(formData.get("started_at_local") ?? "");
  const endedLocal = String(formData.get("ended_at_local") ?? "");
  const miles = Number(formData.get("distance_miles") ?? 0);
  const classification = String(
    formData.get("classification") ?? "unclassified",
  );
  const tzOffsetMin = Number(formData.get("tz_offset_min") ?? 0);
  const method =
    String(formData.get("method") ?? "") === "directions"
      ? "directions"
      : "straight_line";
  const stopsSummary = String(formData.get("stops_summary") ?? "").slice(0, 300);

  // Route polyline, validated & clamped. Never trust the client's array
  // shape or size; keep only well-formed coordinates, cap the count.
  let path: { lat: number; lng: number }[] = [];
  try {
    const raw = JSON.parse(String(formData.get("path") ?? "[]"));
    if (Array.isArray(raw)) {
      path = raw
        .filter(
          (p) =>
            p &&
            Number.isFinite(p.lat) &&
            Number.isFinite(p.lng) &&
            Math.abs(p.lat) <= 90 &&
            Math.abs(p.lng) <= 180,
        )
        .slice(0, 500)
        .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    }
  } catch {
    /* malformed path, save the trip without a drawn line */
  }

  if (!startedLocal || !endedLocal) throw new Error("Pick a start and an end time.");
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

  // Same naive-datetime → UTC reconstruction as addManualTrip.
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
  const deductionCents = tripDeductionCents({ distanceMiles: miles }, cls, taxYear);

  const note =
    `Reconstructed from entered stops${stopsSummary ? ` (${stopsSummary})` : ""}. ` +
    (method === "directions"
      ? "Road distance via Google Directions."
      : "Straight-line estimate, may under-count road miles.") +
    " Verify before claiming.";

  const { data: insertedTrip, error } = await admin
    .from("mileage_trips")
    .insert({
      company_id: companyId,
      driver_user_id: user.id,
      started_at: startedAt,
      ended_at: endedAt,
      distance_miles: Number(miles.toFixed(3)),
      classification: cls,
      tax_year: taxYear,
      deduction_cents: deductionCents,
      notes: note.slice(0, 500),
    })
    .select("id")
    .single();
  if (error || !insertedTrip) throw new Error("Couldn't save. Please try again.");

  const tripId = insertedTrip.id as string;

  // Persist the route polyline so the trip draws on the map like a tracked
  // drive. Interpolate timestamps evenly across the trip window so the points
  // are ordered and the map renders them in sequence.
  if (path.length >= 2) {
    const startMs = new Date(startedAt).getTime();
    const spanMs = new Date(endedAt).getTime() - startMs;
    const rows = path.map((p, i) => ({
      trip_id: tripId,
      captured_at: new Date(
        startMs + Math.round((spanMs * i) / (path.length - 1)),
      ).toISOString(),
      lat: p.lat,
      lng: p.lng,
    }));
    await admin.from("mileage_points").insert(rows);
  }

  if (cls === "unclassified") {
    await notify(user.id, { kind: "trip_classify", tripId });
  } else {
    await notify(user.id, { kind: "trip_logged", tripId, classification: cls });
  }

  await logCompanyActivity(admin, {
    companyId,
    actorUserId: user.id,
    kind: "mileage.added",
    summary: `Reconstructed a ${miles.toFixed(1)}-mile drive from entered stops (${cls})`,
    payload: { trip_id: tripId, distance_miles: miles, classification: cls, method },
  });

  revalidatePath("/mileage");
  revalidatePath("/mileage/classify");
  revalidatePath("/mileage/business");
  revalidatePath("/c/[publicId]/money-out", "page");
  revalidatePath("/c/[publicId]/my-deductions", "page");
  revalidatePath("/c/[publicId]/forecast", "page");
  revalidatePath("/c/[publicId]/savings-goals", "page");
}

/**
 * Manual drive entry, the backfill option when the tracker missed
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

  const { data: insertedTrip, error } = await admin
    .from("mileage_trips")
    .insert({
      company_id: companyId,
      driver_user_id: user.id,
      started_at: startedAt,
      ended_at: endedAt,
      distance_miles: Number(miles.toFixed(3)),
      classification: cls,
      tax_year: taxYear,
      deduction_cents: deductionCents,
      notes: "manual entry",
    })
    .select("id")
    .single();
  if (error || !insertedTrip) {
    throw new Error("Couldn't save. Please try again.");
  }

  // Notify the driver that a drive was saved, same contract as the
  // GPS-tracked path in /api/mileage/ingest, so "any saved drive
  // notifies you" holds for hand-entered trips too. notify() never
  // throws and is idempotent (deduped on tripId), so it's safe to
  // await before returning; a no-op when push isn't configured.
  const tripId = insertedTrip.id as string;
  if (cls === "unclassified") {
    await notify(user.id, { kind: "trip_classify", tripId });
  } else {
    await notify(user.id, { kind: "trip_logged", tripId, classification: cls });
  }

  await logCompanyActivity(admin, {
    companyId,
    actorUserId: user.id,
    kind: "mileage.added",
    summary: `Logged a manual ${miles.toFixed(1)}-mile trip (${cls})`,
    payload: { trip_id: tripId, distance_miles: miles, classification: cls },
  });

  revalidatePath("/mileage");
  revalidatePath("/mileage/classify");
  revalidatePath("/mileage/business");
  revalidatePath("/c/[publicId]/money-out", "page");
  revalidatePath("/c/[publicId]/my-deductions", "page");
  revalidatePath("/c/[publicId]/forecast", "page");
  revalidatePath("/c/[publicId]/savings-goals", "page");
}
