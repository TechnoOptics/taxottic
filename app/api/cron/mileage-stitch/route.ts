import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { tripDeductionCents } from "@/lib/mileage/deduction";
import {
  planFragmentMerges,
  type FragmentTrip,
} from "@/lib/mileage/merge-fragments";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Re-join drives that finalize severed on an upload stall.
 *
 * WHY THIS EXISTS. finalize used to close the open trip whenever the
 * newest point the SERVER HAD was ten minutes old. That measures upload
 * recency, not driving, so a phone whose WebView could not flush looked
 * exactly like a parked car. On 2026-08-09 the driver's handset had
 * eleven upload stalls of 11 to 152 minutes while GPS capture ran fine
 * throughout, and every trip boundary that day landed on a stall
 * boundary: three drives cut in half, each seam six seconds wide.
 *
 * lib/mileage/tail-close.ts stops it happening again. This repairs what
 * already happened, and keeps running because the same shape can still
 * arise from a genuinely dead app or a forced close.
 *
 * SAFETY. The merge requires a seam that is BOTH under two minutes and
 * under 400 metres; see lib/mileage/merge-fragments.ts for why the
 * spatial half is non-negotiable. Distances are the measured values plus
 * the measured seam, never an estimate, so this cannot inflate a
 * deduction.
 *
 * The surviving row keeps its own id, classification and notes, so a
 * drive the user already categorised stays categorised.
 */

/** How far back to look. Comfortably beyond the 30-day raw retention. */
const WINDOW_DAYS = 45;

export async function GET(req: NextRequest) {
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const isAuthed = !!secret && auth === `Bearer ${secret}`;
  if (!isCron && !isAuthed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  const admin = createServiceClient();
  const sinceIso = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60_000,
  ).toISOString();

  const { data: trips, error } = await admin
    .from("mileage_trips")
    .select(
      "id, driver_user_id, company_id, started_at, ended_at, distance_miles, classification, classified_by, classified_at, notes, tax_year",
    )
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: true });
  if (error) {
    console.error("[mileage-stitch] trip fetch failed", error.message);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  // Endpoint coordinates come from the materialised track, so the seam is
  // measured between two real fixes rather than assumed.
  const byDriver = new Map<string, FragmentTrip[]>();
  const meta = new Map<string, (typeof trips)[number]>();
  for (const t of trips ?? []) {
    const [first, last] = await Promise.all([
      admin
        .from("mileage_points")
        .select("lat, lng")
        .eq("trip_id", t.id)
        .order("captured_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      admin
        .from("mileage_points")
        .select("lat, lng")
        .eq("trip_id", t.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    // A trip with no stored track cannot be positioned, so it is never a
    // merge candidate. Silence beats a guessed coordinate.
    if (!first.data || !last.data) continue;

    meta.set(t.id, t);
    const key = `${t.driver_user_id}:${t.company_id}`;
    const list = byDriver.get(key) ?? [];
    list.push({
      id: t.id as string,
      startedAtMs: Date.parse(t.started_at as string),
      endedAtMs: Date.parse(t.ended_at as string),
      distanceMiles: Number(t.distance_miles ?? 0),
      startLat: first.data.lat as number,
      startLng: first.data.lng as number,
      endLat: last.data.lat as number,
      endLng: last.data.lng as number,
    });
    byDriver.set(key, list);
  }

  let merged = 0;
  let absorbed = 0;
  const details: Array<Record<string, unknown>> = [];

  for (const [key, list] of byDriver) {
    for (const plan of planFragmentMerges(list)) {
      const keeper = meta.get(plan.keepId);
      if (!keeper) continue;

      details.push({
        driver: key.split(":")[0],
        keep: plan.keepId,
        absorb: plan.absorbIds,
        milesBefore: Number(keeper.distance_miles ?? 0),
        milesAfter: plan.distanceMiles,
        endedAt: new Date(plan.endedAtMs).toISOString(),
      });

      if (dryRun) {
        merged++;
        absorbed += plan.absorbIds.length;
        continue;
      }

      // Re-point the absorbed tracks at the surviving trip BEFORE deleting
      // the rows, so a failure here can never orphan points.
      const { error: ptErr } = await admin
        .from("mileage_points")
        .update({ trip_id: plan.keepId })
        .in("trip_id", plan.absorbIds);
      if (ptErr) {
        console.error("[mileage-stitch] point re-point failed", ptErr.message);
        continue;
      }

      // CARRY A HUMAN CLASSIFICATION ACROSS THE SEAM.
      //
      // The merge deletes the absorbed fragments, so anything the driver
      // decided about one of them dies with it unless it is carried
      // here. Previously the keeper's classification was simply applied
      // to the merged trip, so if you reclassified the SECOND half of a
      // severed drive, that decision was silently discarded and the
      // machine's guess won.
      //
      // finalize.ts does the same carry for its own overlap merges
      // ("audit critical #2"); this path was missing it. A human
      // decision outranks the machine, and where both halves were
      // classified by a human the keeper wins as the survivor.
      const absorbedAuthored = plan.absorbIds
        .map((id) => meta.get(id))
        .find((f) => f && f.classified_by);
      const keeperAuthored = Boolean(keeper.classified_by);
      const carry =
        !keeperAuthored && absorbedAuthored
          ? {
              classification: absorbedAuthored.classification as string,
              classified_by: absorbedAuthored.classified_by as string,
              classified_at: absorbedAuthored.classified_at as string,
            }
          : null;
      const finalClassification = (carry?.classification ??
        keeper.classification) as "business" | "personal" | "unclassified";

      const deduction = tripDeductionCents(
        { distanceMiles: plan.distanceMiles },
        finalClassification,
        Number(keeper.tax_year),
        keeper.started_at as string,
      );

      const { error: upErr } = await admin
        .from("mileage_trips")
        .update({
          ended_at: new Date(plan.endedAtMs).toISOString(),
          distance_miles: plan.distanceMiles,
          deduction_cents: deduction,
          ...(carry ?? {}),
        })
        .eq("id", plan.keepId);
      if (upErr) {
        console.error("[mileage-stitch] keeper update failed", upErr.message);
        continue;
      }

      const { error: delErr } = await admin
        .from("mileage_trips")
        .delete()
        .in("id", plan.absorbIds);
      if (delErr) {
        console.error("[mileage-stitch] fragment delete failed", delErr.message);
        continue;
      }

      merged++;
      absorbed += plan.absorbIds.length;
    }
  }

  console.log(
    `[mileage-stitch] dryRun=${dryRun} merged=${merged} absorbed=${absorbed}`,
  );
  return NextResponse.json({ ok: true, dryRun, merged, absorbed, details });
}
