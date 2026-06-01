import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-month business mileage rollup for a company + tax year.
 *
 * The business mileage deduction lives in `mileage_trips` (one row per
 * drive, classification='business', deduction_cents stored at the IRS
 * rate when the trip materialized). This is the single source the
 * Expenses list, the Dashboard tile, and the My Deductions month-by-
 * month breakdown all read so the figure is consistent everywhere — the
 * deduction was previously siloed off the expenses/dashboard views.
 *
 * Month is derived from started_at (UTC) — good enough for tax-year
 * grouping; the trips are already tax_year-scoped.
 */
export type MileageMonth = {
  /** 1-12 */
  month: number;
  cents: number;
  miles: number;
  trips: number;
};

export type MileageSummary = {
  /** Months that actually have business drives, ascending. */
  byMonth: MileageMonth[];
  /** Quick lookup month → rollup. */
  monthMap: Map<number, MileageMonth>;
  ytdCents: number;
  ytdMiles: number;
  ytdTrips: number;
};

export async function getBusinessMileageSummary(
  supabase: SupabaseClient,
  companyId: string,
  taxYear: number,
): Promise<MileageSummary> {
  const { data } = await supabase
    .from("mileage_trips")
    .select("started_at, distance_miles, deduction_cents")
    .eq("company_id", companyId)
    .eq("classification", "business")
    .eq("tax_year", taxYear);

  const rows = (data ?? []) as Array<{
    started_at: string;
    distance_miles: number | null;
    deduction_cents: number | null;
  }>;

  const monthMap = new Map<number, MileageMonth>();
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
    ytdCents += cents;
    ytdMiles += miles;
    ytdTrips += 1;
  }

  const byMonth = Array.from(monthMap.values()).sort(
    (a, b) => a.month - b.month,
  );
  return { byMonth, monthMap, ytdCents, ytdMiles, ytdTrips };
}
