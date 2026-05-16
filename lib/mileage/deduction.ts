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
 * back (getTaxYearConstants handles that) — the caller can surface
 * `isFallback` if it needs to warn.
 */
export function businessMileageDeductionCents(
  miles: number,
  taxYear: number,
): number {
  if (!(miles > 0)) return 0;
  const rate = getTaxYearConstants(taxYear).MILEAGE_RATE_PER_MILE_CENTS;
  return Math.round(miles * rate);
}

/**
 * Deduction for a single segmented trip. Personal / unclassified
 * trips are worth $0 — only confirmed business travel deducts.
 * The standard mileage method (not actual-expense) is assumed; the
 * two methods are mutually exclusive per vehicle per year and the
 * standard method is what a per-trip tracker supports.
 */
export function tripDeductionCents(
  trip: Pick<Trip, "distanceMiles">,
  classification: Classification,
  taxYear: number,
): number {
  if (classification !== "business") return 0;
  return businessMileageDeductionCents(trip.distanceMiles, taxYear);
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
