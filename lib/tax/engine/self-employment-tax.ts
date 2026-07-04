import type { TaxYearConstants } from "../constants";

// Self-employment (SECA) tax: Social Security portion (capped at the wage
// base, shared with W-2 SS wages) + uncapped Medicare portion. The 0.9%
// additional Medicare surtax is intentionally NOT here — it applies to
// COMBINED W-2 + SE earnings above a household threshold and is added in
// forecast() at the household level.

export function computeSelfEmploymentTax(args: {
  netBizCents: number;
  ownerW2SsWagesCents: number;
  k: TaxYearConstants;
}): { totalSeTax: number; seEarnings: number } {
  const seEarnings = Math.round(
    args.netBizCents * args.k.SE_TAX.netEarningsFactor,
  );
  if (seEarnings <= 0) return { totalSeTax: 0, seEarnings: 0 };

  // SS portion is capped at the wage base, but the wage base is shared
  // with W-2 SS wages already earned in the year. Whatever's left of the
  // base is what SE earnings can be taxed against.
  const ssCap = args.k.SE_TAX.socialSecurityWageBase;
  const ssRemaining = Math.max(
    0,
    ssCap - Math.max(0, args.ownerW2SsWagesCents),
  );
  const ssBase = Math.min(seEarnings, ssRemaining);
  const ssTax = Math.round(ssBase * args.k.SE_TAX.socialSecurityRate);

  const medicareTax = Math.round(seEarnings * args.k.SE_TAX.medicareRate);

  return { totalSeTax: ssTax + medicareTax, seEarnings };
}
