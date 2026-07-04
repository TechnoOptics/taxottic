import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-month business mileage rollup for a company + tax year.
 *
 * The business mileage deduction lives in `mileage_trips` (one row per
 * drive, classification='business', deduction_cents stored at the IRS
 * rate when the trip materialized). This is the single source the
 * Expenses list, the Dashboard tile, and the My Deductions month-by-
 * month breakdown all read so the figure is consistent everywhere, the
 * deduction was previously siloed off the expenses/dashboard views.
 *
 * Month is derived from started_at (UTC), good enough for tax-year
 * grouping; the trips are already tax_year-scoped.
 */
export type MileageMonth = {
  /** 1-12 */
  month: number;
  cents: number;
  miles: number;
  trips: number;
};

/** One business drive, for the day-by-day deduction lines. */
export type MileageTrip = {
  id: string;
  /** ISO timestamp the drive started (UTC). */
  startedAt: string;
  /** 1-12, derived from startedAt (UTC). */
  month: number;
  miles: number;
  cents: number;
};

export type MileageSummary = {
  /** Months that actually have business drives, ascending. */
  byMonth: MileageMonth[];
  /** Quick lookup month → rollup. */
  monthMap: Map<number, MileageMonth>;
  /** Every business drive, most-recent first, for per-day lines. */
  trips: MileageTrip[];
  ytdCents: number;
  ytdMiles: number;
  ytdTrips: number;
};

export async function getBusinessMileageSummary(
  supabase: SupabaseClient,
  companyId: string,
  taxYear: number,
  // Optional per-driver scope. When the Expenses list is filtered to a
  // single employee, the mileage rollup is filtered to that employee's
  // drives too (mileage_trips.driver_user_id) so the page's totals stay
  // internally consistent. Omit (or pass null) for the company-wide
  // rollup the Dashboard / My Deductions use.
  driverUserId?: string | null,
): Promise<MileageSummary> {
  let query = supabase
    .from("mileage_trips")
    .select("id, started_at, distance_miles, deduction_cents")
    .eq("company_id", companyId)
    .eq("classification", "business")
    .eq("tax_year", taxYear)
    .order("started_at", { ascending: false });
  if (driverUserId) query = query.eq("driver_user_id", driverUserId);
  const { data } = await query;

  const rows = (data ?? []) as Array<{
    id: string;
    started_at: string;
    distance_miles: number | null;
    deduction_cents: number | null;
  }>;

  const monthMap = new Map<number, MileageMonth>();
  const trips: MileageTrip[] = [];
  let ytdCents = 0;
  let ytdMiles = 0;
  let ytdTrips = 0;

  for (const r of rows) {
    const month = new Date(r.started_at).getUTCMonth() + 1;
    const cents = Number(r.deduction_cents ?? 0);
    const miles = Number(r.distance_miles ?? 0);
    const cur =
      monthMap.get(month) ?? { month, cents: 0, miles: 0, trips: 0 };
    cur.cents += cents;
    cur.miles += miles;
    cur.trips += 1;
    monthMap.set(month, cur);
    trips.push({ id: r.id, startedAt: r.started_at, month, miles, cents });
    ytdCents += cents;
    ytdMiles += miles;
    ytdTrips += 1;
  }

  const byMonth = Array.from(monthMap.values()).sort(
    (a, b) => a.month - b.month,
  );
  // `trips` is already most-recent-first (query orders started_at desc).
  return { byMonth, monthMap, trips, ytdCents, ytdMiles, ytdTrips };
}
