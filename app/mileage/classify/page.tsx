import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { ClassifyDeck } from "@/components/mileage/ClassifyDeck";
import { businessMileageDeductionCents } from "@/lib/mileage/deduction";
import {
  applyAwaitingDecisionFilter,
  assumedCall,
} from "@/lib/mileage/awaiting-decision";
import { classifyTrip } from "./actions";

export type PendingTrip = {
  id: string;
  startedAtISO: string;
  endedAtISO: string;
  distanceMiles: number;
  estDeductionCents: number;
  /** Route breadcrumb (bounded, evenly-strided) so the reviewer can SEE
   *  where the drive went before calling it business or personal -
   *  empty when the trip has no recorded points (e.g. a very old
   *  reconstructed/manual entry). */
  points: { lat: number; lng: number }[];
  /** The call the app already made on its own, which this card is asking
   *  the driver to confirm or correct. Null when nothing was decided. */
  assumed: "business" | "personal" | null;
};

type Search = Promise<{ trip?: string }>;

export default async function ClassifyPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const { admin, user } = await requireUserWithAdmin();
  const { trip: targetTripId } = await searchParams;

  // Every drive the user owns that is waiting on a decision, across the
  // companies they belong to. The /api/watch/confirm flow uses
  // driver_user_id as the primary auth gate; we mirror that here.
  //
  // This used to select `classification = 'unclassified'` and nothing
  // else, which made the deck unable to act on the commonest pending
  // state. A drive the machine classified with `needs_confirmation` is
  // held out of the Schedule C headline by #616 and never counted as a
  // guess to settle, so a driver with five of them and no unclassified
  // drive was redirected straight back to /mileage as "caught up".
  //
  // applyAwaitingDecisionFilter is the SAME filter the count on /mileage
  // applies, deliberately shared: a badge promising drives the deck then
  // has nothing to show is worse than no badge. See
  // lib/mileage/awaiting-decision.ts and its wiring test.
  //
  // Confirming needs no separate control here. classifyTrip routes
  // through reclassifyTripCore, which clears the flag and writes the real
  // deduction, so tapping Business on an assumed-business drive IS the
  // confirmation and tapping Personal is the correction.
  const { data } = await applyAwaitingDecisionFilter(
    admin
      .from("mileage_trips")
      .select(
        "id, started_at, ended_at, distance_miles, tax_year, classification, needs_confirmation",
      )
      .eq("driver_user_id", user.id),
  )
    .order("started_at", { ascending: false })
    .limit(20);

  const tripRows = (data ?? []) as {
    id: string;
    started_at: string;
    ended_at: string;
    distance_miles: number;
    tax_year: number;
    classification: string | null;
    needs_confirmation: boolean | null;
  }[];

  // Route polylines for every pending trip in one round-trip, via the
  // same bounded RPC the /mileage overview map uses, NOT an embedded
  // mileage_points(...) join, which PostgREST caps at 1000 rows and
  // would truncate a long drive mid-route. p_max is smaller here (150)
  // since each card only needs a smooth-enough line, not a YTD overview.
  const pointsByTrip = new Map<string, { lat: number; lng: number }[]>();
  if (tripRows.length > 0) {
    const { data: polyRows } = await admin.rpc("mileage_trip_polylines", {
      p_trip_ids: tripRows.map((t) => t.id),
      p_max: 150,
    });
    for (const r of (polyRows ?? []) as {
      trip_id: string;
      lat: number;
      lng: number;
    }[]) {
      const arr = pointsByTrip.get(r.trip_id);
      const pt = { lat: r.lat, lng: r.lng };
      if (arr) arr.push(pt);
      else pointsByTrip.set(r.trip_id, [pt]);
    }
  }

  const pending: PendingTrip[] = tripRows.map((r) => {
    const miles = Number(r.distance_miles || 0);
    return {
      id: r.id,
      startedAtISO: r.started_at,
      endedAtISO: r.ended_at,
      distanceMiles: miles,
      estDeductionCents: businessMileageDeductionCents(miles, r.tax_year),
      points: pointsByTrip.get(r.id) ?? [],
      assumed: assumedCall(r),
    };
  });

  // Nothing to do, bounce back to Mileage so the user sees the
  // map / breadcrumbs instead of a stranded empty page.
  if (pending.length === 0) {
    redirect("/mileage?caughtup=1");
  }

  // Deep-linked from the outstanding-items list (?trip=<id>): the deck
  // always starts at index 0, so move the target trip to the front
  // instead of leaving the reviewer to hunt for it in the stack.
  if (targetTripId) {
    const idx = pending.findIndex((p) => p.id === targetTripId);
    if (idx > 0) {
      const [target] = pending.splice(idx, 1);
      pending.unshift(target);
    }
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-md mx-auto px-4 sm:px-6 py-8">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Mileage · review
        </div>
        <h1 className="display mt-2 text-2xl text-forest-900">
          {pending.length === 1
            ? "One drive needs a quick call."
            : `${pending.length} drives need a quick call.`}
        </h1>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          Tap <strong>Business</strong> if the drive was for work, it
          counts toward your Schedule C mileage deduction. Tap{" "}
          <strong>Personal</strong> if it&apos;s a regular errand. Same
          calls the watch surface for the swipe deck, just bigger.
        </p>

        <ClassifyDeck pending={pending} action={classifyTrip} />

        <div className="mt-8 text-center">
          <Link
            href="/mileage"
            className="text-xs text-ink-muted hover:text-forest-900 underline underline-offset-2"
          >
            Back to mileage
          </Link>
        </div>
      </section>
    </main>
  );
}
