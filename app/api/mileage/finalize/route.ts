import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMyCompanies } from "@/lib/auth";
import { finalizeUserTrips } from "@/lib/mileage/finalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mileage/finalize
//
// Run the caller's freshness pass and WAIT for it, however long it takes.
//
// WHY THIS EXISTS AND WHY IT HAS NO TIMEOUT
//
// The /mileage server render time-boxes finalize at 2.5s so a huge staging
// pool cannot hold the page hostage. Promise.race does not cancel the
// loser, so a run that overran the budget used to finish into the void:
// the page had already rendered without the drive, and the drive surfaced
// only on some later render. The user's report was exactly that shape.
//
// So when the render reports the run was still outstanding, the client
// calls this once and refreshes when it returns. A timeout here would
// reintroduce the very race it exists to settle. The client aborts if the
// user navigates away, and the mileage-finalize cron is still the backstop
// if this request never lands at all.
//
// finalize is idempotent and overlap-guarded, so a run overlapping the
// render's own run is safe: that is the same property that already makes
// racing the cron safe.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Same company the page renders, chosen the same way, so this cannot
  // materialise drives into a company the page is not showing.
  const memberships = await getMyCompanies();
  const companyId = memberships[0]?.company?.id;
  if (!companyId) {
    return NextResponse.json({ error: "no_company" }, { status: 400 });
  }

  const admin = createServiceClient();
  try {
    const result = await finalizeUserTrips(admin, user.id, companyId, {
      // Identical window and flags to the page render: never sever a drive
      // that is still in progress, and no push for a drive the user is
      // already looking at.
      sinceIso: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      forceClose: false,
      push: false,
    });
    return NextResponse.json({ ok: true, tripsCreated: result.tripsCreated });
  } catch (e) {
    console.error(
      "[mileage/finalize] settle run failed",
      e instanceof Error ? e.message : e,
    );
    // The client refreshes only on ok, so a failure here just leaves the
    // page as rendered. Never surface an error to somebody who did nothing
    // but open their drive log.
    return NextResponse.json({ error: "finalize_failed" }, { status: 500 });
  }
}
