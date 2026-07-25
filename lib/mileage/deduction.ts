// Mileage → IRS standard-mileage-rate deduction.
//
// "Once classified as work travel, apply the appropriate
// deduction." The IRS standard business mileage rate already
// lives in the tax constants (MILEAGE_RATE_*_PER_MILE_CENTS,
// surfaced per year by getTaxYearConstants). This module is the
// thin, tested bridge from segmented miles → deductible cents,
// and only BUSINESS-classified trips count.

import { getTaxYearConstants } from "@/lib/tax/constants";
import type { Classification, Trip } from "./segmentation";

/**
 * Deductible cents for `miles` business miles in `taxYear` at the
 * IRS standard mileage rate. Years outside the bundled set fall
 * back (getTaxYearConstants handles that), the caller can surface
 * `isFallback` if it needs to warn.
 */
/**
 * The IRS rate in force on a given date. Split-rate years (2026: 72.5¢
 * Jan–Jun, 76¢ from Jul 1 per the mid-year adjustment) resolve by the
 * trip's own date; flat years and undated calls fall back to the year
 * constant. String compare is safe: both sides are ISO yyyy-mm-dd...
 */
export function mileageRateCentsForDate(
  taxYear: number,
  dateIso?: string | null,
): number {
  const k = getTaxYearConstants(taxYear);
  const periods = k.MILEAGE_RATE_PERIODS;
  if (!periods?.length || !dateIso) return k.MILEAGE_RATE_PER_MILE_CENTS;
  let rate = periods[0].centsPerMile;
  for (const p of periods) {
    if (dateIso >= p.fromIso) rate = p.centsPerMile;
  }
  return rate;
}

/**
 * Whole-year average rate, month-weighted. For pricing an ANNUAL
 * projection of undated miles in a split-rate year (a manual YTD
 * estimate annualized to Dec 31 spans both rate periods).
 */
export function fullYearAverageMileageRateCents(taxYear: number): number {
  const k = getTaxYearConstants(taxYear);
  const periods = k.MILEAGE_RATE_PERIODS;
  if (!periods?.length) return k.MILEAGE_RATE_PER_MILE_CENTS;
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const iso = `${taxYear}-${String(m).padStart(2, "0")}-01`;
    total += mileageRateCentsForDate(taxYear, iso);
  }
  return total / 12;
}

export function businessMileageDeductionCents(
  miles: number,
  taxYear: number,
  tripDateIso?: string | null,
): number {
  if (!(miles > 0)) return 0;
  return Math.round(miles * mileageRateCentsForDate(taxYear, tripDateIso));
}

/**
 * Deduction for a single segmented trip. Personal / unclassified
 * trips are worth $0, only confirmed business travel deducts.
 * The standard mileage method (not actual-expense) is assumed; the
 * two methods are mutually exclusive per vehicle per year and the
 * standard method is what a per-trip tracker supports.
 */
export function tripDeductionCents(
  trip: Pick<Trip, "distanceMiles">,
  classification: Classification,
  taxYear: number,
  tripDateIso?: string | null,
): number {
  if (classification !== "business") return 0;
  return businessMileageDeductionCents(trip.distanceMiles, taxYear, tripDateIso);
}

/**
 * Roll up many already-classified trips into a single deductible
 * total + a business-miles total (for the Schedule C car/truck
 * line and the forecast's deduction stack).
 */
export function summarizeMileageDeduction(
  trips: Array<{ distanceMiles: number; classification: Classification }>,
  taxYear: number,
): { businessMiles: number; deductionCents: number } {
  let businessMiles = 0;
  for (const t of trips) {
    if (t.classification === "business") businessMiles += t.distanceMiles;
  }
  return {
    businessMiles,
    deductionCents: businessMileageDeductionCents(businessMiles, taxYear),
  };
}

/**
 * Decide which auto-mileage deduction flows into the forecast engine's
 * `autoMileageCents`, for both the YTD ("close the books today") and
 * the year-end projected scenarios.
 *
 * Precedence, and the reason this lives in one tested place rather
 * than inline in two pages:
 *
 *  1. The standard-mileage vs. actual-expense election is binding per
 *     vehicle per year. The stored per-trip `deduction_cents` is a
 *     standard-rate figure, so on the actual-expense method (or no
 *     vehicle) NEITHER path applies, result is zero.
 *  2. If the company actually used the GPS tracker and has classified-
 *     business trips, that is an IRS-grade contemporaneous mileage log
 *, strictly better evidence than a hand-typed
 *     `vehicle_business_miles` estimate, so it wins. Its YTD value is
 *     ground truth (real, dated drives, not pace-projected); the
 *     year-end figure pace-projects that real YTD with the same month
 *     basis the manual path uses.
 *  3. Otherwise fall back to the caller's manual estimate unchanged
 *     (users who never opened the tracker see zero behaviour change).
 *
 * The caller passes its already-computed manual figures so the (page-
 * specific) manual projection basis stays where it belongs.
 */
export function resolveAutoMileageCents(args: {
  /** business_profiles.has_vehicle && vehicle_method !== "actual". */
  onStandardVehicle: boolean;
  /** vehicle_method === "actual": an explicit election OUT of standard
   *  mileage. Deliberately distinct from an unconfigured profile, see the
   *  implied-vehicle rule below. */
  onActualMethod?: boolean;
  /** Σ stored deduction_cents for classified-business trips this year. */
  trackedYtdCents: number;
  /** Count of those classified-business tracked trips. */
  trackedTripCount: number;
  /** Manual-estimate fallback, annualized to year-end. */
  manualProjectedCents: number;
  /** Manual-estimate fallback pro-rated to the elapsed year. */
  manualYtdCents: number;
  /** Months of real data; pace-projects the tracked YTD to year-end. */
  trackedProjectionMonths: number;
}): { ytdCents: number; projectedCents: number } {
  const useTracked =
    args.trackedTripCount > 0 && args.trackedYtdCents > 0;

  // Classified-business drives are themselves evidence of a business
  // vehicle. An unset has_vehicle is a PROFILE GAP, not an election of the
  // actual-expense method, so it must not silently zero a real tracked
  // deduction: observed in production, a company with 3 classified-business
  // trips showed a $36.61 deduction on the Mileage page while the forecast
  // valued the same drives at $0, with nothing on screen explaining why.
  // Only an explicit vehicle_method === "actual" opts out, because there
  // the vehicle is deducted through real costs instead and adding standard
  // mileage on top would double-count.
  const impliedByTracking = useTracked && args.onActualMethod !== true;
  if (!args.onStandardVehicle && !impliedByTracking) {
    return { ytdCents: 0, projectedCents: 0 };
  }
  if (useTracked) {
    const months = Math.min(
      12,
      Math.max(1, args.trackedProjectionMonths),
    );
    return {
      ytdCents: args.trackedYtdCents,
      projectedCents: Math.round((args.trackedYtdCents * 12) / months),
    };
  }
  return {
    ytdCents: args.manualYtdCents,
    projectedCents: args.manualProjectedCents,
  };
}
