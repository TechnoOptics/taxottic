/**
 * State income tax brackets, real bracket-by-bracket math for the
 * highest-impact states.
 *
 * The forecast engine has historically applied a single flat rate per
 * state (an effective-average curated by hand). For low-tax flat-rate
 * states (PA 3.07%, IL 4.95%, AZ 2.5%, etc.) that's accurate -
 * those ARE flat. But for the high-tax progressive states (CA, NY,
 * NJ, MA + surcharge, MN, OR, HI, DC) the flat rate can be off by
 * thousands of dollars at higher incomes. A user in CA earning $250k
 * paid ~7% effective in the curated table but their actual marginal
 * is 9.3% and effective closer to 8%.
 *
 * This module replaces the flat-rate approximation for the states
 * where it materially distorts the forecast. States not listed fall
 * back to the existing `stateRate()` flat-rate function in
 * constants-2025.ts.
 *
 * Year coverage: 2025 + 2026. Where 2026 hasn't been finalized by
 * the state (most have only published 2025), we use the 2025 brackets
 * and document this. The forecast surfaces an assumption noting
 * which year's table was used so the user can verify.
 *
 * Standard deductions / personal exemptions: state tax bases differ
 * from federal taxable income (CA has its own deductions, NY has a
 * standard deduction, MA starts from federal AGI minus its own
 * adjustments). For a forecast we apply the rate table to federal
 * taxable income as a reasonable approximation. Surfacing the
 * remaining error per state is a future enhancement.
 *
 * Filing-status handling: states either (a) use a single bracket
 * table for everyone (MA flat + surcharge), (b) double the brackets
 * for MFJ (CA, NY), or (c) have a separate MFJ column (NJ has
 * different ranges, not just doubled). The per-state table below
 * captures the exact rules for each.
 */

import type { FilingStatus } from "./constants-2025";

type StateBracket = { rate: number; upTo: number | null };

type StateTable = {
  /** Single / HoH / MFS / Qualifying Widow share a column unless the
   *  state has explicit separate tables. */
  single: StateBracket[];
  /** MFJ, only present when the state has separate brackets for it. */
  married_filing_jointly?: StateBracket[];
  /** Optional surcharge for incomes over a high threshold (MA $1M, CA
   *  mental health surcharge, etc.). */
  surcharge?: {
    rate: number;
    threshold: number;
    /** True if the surcharge is computed on the EXCESS over the
     *  threshold (e.g. MA: 4% × max(0, income - $1M)); false if it's
     *  computed on the FULL income above (rare). */
    onExcess: boolean;
    note: string;
  };
};

const cents = (dollars: number) => Math.round(dollars * 100);

// ============================================================================
// California - § 17041
// 2025 brackets; CA Franchise Tax Board typically publishes 2026 in
// late October 2025 but our reference here is 2025 (and CA inflation-
// adjusts every year via the CPI factor in § 17041(h)).
// Plus the 1% "mental health services" surcharge under § 17043 on
// taxable income > $1,000,000.
// ============================================================================
const CA_2025: StateTable = {
  single: [
    { rate: 0.01, upTo: cents(10_756) },
    { rate: 0.02, upTo: cents(25_499) },
    { rate: 0.04, upTo: cents(40_245) },
    { rate: 0.06, upTo: cents(55_866) },
    { rate: 0.08, upTo: cents(70_606) },
    { rate: 0.093, upTo: cents(360_659) },
    { rate: 0.103, upTo: cents(432_787) },
    { rate: 0.113, upTo: cents(721_314) },
    { rate: 0.123, upTo: null },
  ],
  married_filing_jointly: [
    { rate: 0.01, upTo: cents(21_512) },
    { rate: 0.02, upTo: cents(50_998) },
    { rate: 0.04, upTo: cents(80_490) },
    { rate: 0.06, upTo: cents(111_732) },
    { rate: 0.08, upTo: cents(141_212) },
    { rate: 0.093, upTo: cents(721_318) },
    { rate: 0.103, upTo: cents(865_574) },
    { rate: 0.113, upTo: cents(1_442_628) },
    { rate: 0.123, upTo: null },
  ],
  surcharge: {
    rate: 0.01,
    threshold: cents(1_000_000),
    onExcess: true,
    note: "California adds a 1% mental-health services surcharge (§ 17043) on taxable income over $1,000,000.",
  },
};

// ============================================================================
// New York - § 601
// 2025 brackets. Plus optional NYC city tax handled separately if the
// user lives in NYC (we don't capture that yet; flag as a hint).
// ============================================================================
const NY_2025: StateTable = {
  single: [
    { rate: 0.04, upTo: cents(8_500) },
    { rate: 0.045, upTo: cents(11_700) },
    { rate: 0.0525, upTo: cents(13_900) },
    { rate: 0.055, upTo: cents(80_650) },
    { rate: 0.06, upTo: cents(215_400) },
    { rate: 0.0685, upTo: cents(1_077_550) },
    { rate: 0.0965, upTo: cents(5_000_000) },
    { rate: 0.103, upTo: cents(25_000_000) },
    { rate: 0.109, upTo: null },
  ],
  married_filing_jointly: [
    { rate: 0.04, upTo: cents(17_150) },
    { rate: 0.045, upTo: cents(23_600) },
    { rate: 0.0525, upTo: cents(27_900) },
    { rate: 0.055, upTo: cents(161_550) },
    { rate: 0.06, upTo: cents(323_200) },
    { rate: 0.0685, upTo: cents(2_155_350) },
    { rate: 0.0965, upTo: cents(5_000_000) },
    { rate: 0.103, upTo: cents(25_000_000) },
    { rate: 0.109, upTo: null },
  ],
};

// ============================================================================
// New Jersey - § 54A
// 2025 brackets. NJ has SEPARATE MFJ brackets (not just doubled).
// ============================================================================
const NJ_2025: StateTable = {
  single: [
    { rate: 0.014, upTo: cents(20_000) },
    { rate: 0.0175, upTo: cents(35_000) },
    { rate: 0.035, upTo: cents(40_000) },
    { rate: 0.05525, upTo: cents(75_000) },
    { rate: 0.0637, upTo: cents(500_000) },
    { rate: 0.0897, upTo: cents(1_000_000) },
    { rate: 0.1075, upTo: null },
  ],
  married_filing_jointly: [
    { rate: 0.014, upTo: cents(20_000) },
    { rate: 0.0175, upTo: cents(50_000) },
    { rate: 0.0245, upTo: cents(70_000) },
    { rate: 0.035, upTo: cents(80_000) },
    { rate: 0.05525, upTo: cents(150_000) },
    { rate: 0.0637, upTo: cents(500_000) },
    { rate: 0.0897, upTo: cents(1_000_000) },
    { rate: 0.1075, upTo: null },
  ],
};

// ============================================================================
// Massachusetts - 5% flat + 4% surcharge over $1M ("Fair Share Amendment")
// ============================================================================
const MA_2025: StateTable = {
  single: [{ rate: 0.05, upTo: null }],
  surcharge: {
    rate: 0.04,
    threshold: cents(1_083_150), // 2025 inflation-adjusted threshold
    onExcess: true,
    note: "Massachusetts adds a 4% surtax on taxable income above $1,083,150 (2025; inflation-adjusted annually) per Article 44 of the state Constitution (the 'Fair Share Amendment').",
  },
};

// ============================================================================
// Minnesota - 2025 brackets
// ============================================================================
const MN_2025: StateTable = {
  single: [
    { rate: 0.0535, upTo: cents(32_570) },
    { rate: 0.068, upTo: cents(106_990) },
    { rate: 0.0785, upTo: cents(198_630) },
    { rate: 0.0985, upTo: null },
  ],
  married_filing_jointly: [
    { rate: 0.0535, upTo: cents(47_620) },
    { rate: 0.068, upTo: cents(189_180) },
    { rate: 0.0785, upTo: cents(330_410) },
    { rate: 0.0985, upTo: null },
  ],
};

// ============================================================================
// Oregon - 2025 brackets
// ============================================================================
const OR_2025: StateTable = {
  single: [
    { rate: 0.0475, upTo: cents(4_400) },
    { rate: 0.0675, upTo: cents(11_050) },
    { rate: 0.0875, upTo: cents(125_000) },
    { rate: 0.099, upTo: null },
  ],
  married_filing_jointly: [
    { rate: 0.0475, upTo: cents(8_800) },
    { rate: 0.0675, upTo: cents(22_100) },
    { rate: 0.0875, upTo: cents(250_000) },
    { rate: 0.099, upTo: null },
  ],
};

// ============================================================================
// Hawaii - 2025 brackets
// ============================================================================
const HI_2025: StateTable = {
  single: [
    { rate: 0.014, upTo: cents(2_400) },
    { rate: 0.032, upTo: cents(4_800) },
    { rate: 0.055, upTo: cents(9_600) },
    { rate: 0.064, upTo: cents(14_400) },
    { rate: 0.068, upTo: cents(19_200) },
    { rate: 0.072, upTo: cents(24_000) },
    { rate: 0.076, upTo: cents(36_000) },
    { rate: 0.079, upTo: cents(48_000) },
    { rate: 0.0825, upTo: cents(150_000) },
    { rate: 0.09, upTo: cents(175_000) },
    { rate: 0.10, upTo: cents(200_000) },
    { rate: 0.11, upTo: null },
  ],
  married_filing_jointly: [
    { rate: 0.014, upTo: cents(4_800) },
    { rate: 0.032, upTo: cents(9_600) },
    { rate: 0.055, upTo: cents(19_200) },
    { rate: 0.064, upTo: cents(28_800) },
    { rate: 0.068, upTo: cents(38_400) },
    { rate: 0.072, upTo: cents(48_000) },
    { rate: 0.076, upTo: cents(72_000) },
    { rate: 0.079, upTo: cents(96_000) },
    { rate: 0.0825, upTo: cents(300_000) },
    { rate: 0.09, upTo: cents(350_000) },
    { rate: 0.10, upTo: cents(400_000) },
    { rate: 0.11, upTo: null },
  ],
};

// ============================================================================
// District of Columbia - 2025 brackets
// ============================================================================
const DC_2025: StateTable = {
  single: [
    { rate: 0.04, upTo: cents(10_000) },
    { rate: 0.06, upTo: cents(40_000) },
    { rate: 0.065, upTo: cents(60_000) },
    { rate: 0.085, upTo: cents(250_000) },
    { rate: 0.0925, upTo: cents(500_000) },
    { rate: 0.0975, upTo: cents(1_000_000) },
    { rate: 0.1075, upTo: null },
  ],
};

// ============================================================================
// Maryland - 2025 state brackets (county tax adds ~2-3.2% additional;
// we don't model county yet, surface as a hint).
// ============================================================================
const MD_2025: StateTable = {
  single: [
    { rate: 0.02, upTo: cents(1_000) },
    { rate: 0.03, upTo: cents(2_000) },
    { rate: 0.04, upTo: cents(3_000) },
    { rate: 0.0475, upTo: cents(100_000) },
    { rate: 0.05, upTo: cents(125_000) },
    { rate: 0.0525, upTo: cents(150_000) },
    { rate: 0.055, upTo: cents(250_000) },
    { rate: 0.0575, upTo: null },
  ],
  married_filing_jointly: [
    { rate: 0.02, upTo: cents(1_000) },
    { rate: 0.03, upTo: cents(2_000) },
    { rate: 0.04, upTo: cents(3_000) },
    { rate: 0.0475, upTo: cents(150_000) },
    { rate: 0.05, upTo: cents(175_000) },
    { rate: 0.0525, upTo: cents(225_000) },
    { rate: 0.055, upTo: cents(300_000) },
    { rate: 0.0575, upTo: null },
  ],
};

// ============================================================================
// Connecticut - 2025 brackets
// ============================================================================
const CT_2025: StateTable = {
  single: [
    { rate: 0.02, upTo: cents(10_000) },
    { rate: 0.045, upTo: cents(50_000) },
    { rate: 0.055, upTo: cents(100_000) },
    { rate: 0.06, upTo: cents(200_000) },
    { rate: 0.065, upTo: cents(250_000) },
    { rate: 0.069, upTo: cents(500_000) },
    { rate: 0.0699, upTo: null },
  ],
  married_filing_jointly: [
    { rate: 0.02, upTo: cents(20_000) },
    { rate: 0.045, upTo: cents(100_000) },
    { rate: 0.055, upTo: cents(200_000) },
    { rate: 0.06, upTo: cents(400_000) },
    { rate: 0.065, upTo: cents(500_000) },
    { rate: 0.069, upTo: cents(1_000_000) },
    { rate: 0.0699, upTo: null },
  ],
};

const BRACKETS_BY_STATE: Record<string, StateTable> = {
  CA: CA_2025,
  NY: NY_2025,
  NJ: NJ_2025,
  MA: MA_2025,
  MN: MN_2025,
  OR: OR_2025,
  HI: HI_2025,
  DC: DC_2025,
  MD: MD_2025,
  CT: CT_2025,
};

/**
 * State-specific standard deductions for the bracket-tax states.
 *
 * Why this exists separately from the federal std deduction: most
 * states use the FEDERAL AGI as the starting point but apply their
 * own standard-deduction value to compute state taxable income, and
 * NONE of them recognise the federal QBI (§199A) deduction at the
 * state level (QBI is a federal-only below-the-line credit). The
 * May 2026 round-2 audit caught CA tax forecasting at ~$378 on a
 * $50k Single Sole Prop, that came from passing federal taxable
 * income (which already had a $15k+ federal std deduction AND a
 * $6k QBI deduction subtracted) into the CA bracket table, leaving
 * only ~$24k of state taxable income, when the correct CA base
 * (federal AGI minus CA's $5,540 single std deduction, no QBI) is
 * around $40k. Hand-calc with this fix produces ~$1,033, matching
 * the auditor's $900-$1,100 expected range.
 *
 * Numbers below are 2025 values (CA inflation-adjusts annually under
 * §17041(h); other states' figures track similarly). Refresh when
 * each state's department of revenue publishes the next year's
 * figures. For states without a state standard deduction (NJ, MA,
 * CT use personal exemptions instead, different mechanism), the
 * entry is 0 and the bracket math runs against full state AGI.
 */
const STATE_STD_DEDUCTION_BY_STATE: Record<
  string,
  Partial<Record<FilingStatus, number>>
> = {
  CA: {
    single: 554_000, // $5,540
    married_filing_jointly: 1_108_000,
    married_filing_separately: 554_000,
    head_of_household: 1_108_000,
    qualifying_widow: 1_108_000,
  },
  NY: {
    single: 800_000, // $8,000
    married_filing_jointly: 1_605_000,
    married_filing_separately: 800_000,
    head_of_household: 1_125_000,
    qualifying_widow: 1_605_000,
  },
  MN: {
    single: 1_457_500, // $14,575
    married_filing_jointly: 2_915_000,
    married_filing_separately: 1_457_500,
    head_of_household: 2_185_000,
    qualifying_widow: 2_915_000,
  },
  OR: {
    single: 285_500, // $2,855
    married_filing_jointly: 571_000,
    married_filing_separately: 285_500,
    head_of_household: 457_000,
    qualifying_widow: 571_000,
  },
  HI: {
    single: 220_000, // $2,200
    married_filing_jointly: 440_000,
    married_filing_separately: 220_000,
    head_of_household: 330_000,
    qualifying_widow: 440_000,
  },
  DC: {
    single: 1_385_000, // matches federal $13,850 in DC's most-recent year
    married_filing_jointly: 2_770_000,
    married_filing_separately: 1_385_000,
    head_of_household: 2_065_000,
    qualifying_widow: 2_770_000,
  },
  MD: {
    single: 240_000, // $2,400 (capped)
    married_filing_jointly: 485_000,
    married_filing_separately: 240_000,
    head_of_household: 240_000,
    qualifying_widow: 485_000,
  },
  // NJ, MA, CT use personal exemptions rather than a state std
  // deduction. Leaving the entry undefined means the bracket math
  // runs against full state AGI; users with NJ/MA/CT residency see
  // a slight over-estimate at low incomes and a less material
  // distortion at higher incomes. Document for follow-up.
};

/**
 * Public helper: given a federal AGI and the state, return the
 * starting point for state taxable-income math. The engine passes
 * AGI (NOT federal taxable income) so the federal QBI deduction
 * doesn't leak through to the state side.
 */
export function stateTaxableIncomeFromAgi(args: {
  agiCents: number;
  filingStatus: FilingStatus;
  stateCode: string;
}): number {
  const table = STATE_STD_DEDUCTION_BY_STATE[args.stateCode.toUpperCase()];
  const stateStd = table?.[args.filingStatus] ?? 0;
  return Math.max(0, args.agiCents - stateStd);
}

/**
 * Apply a bracket table to an income amount in cents.
 */
function applyBrackets(
  taxableIncomeCents: number,
  brackets: StateBracket[],
): number {
  let remaining = Math.max(0, taxableIncomeCents);
  let lowerBound = 0;
  let tax = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Number.MAX_SAFE_INTEGER;
    const slice = Math.max(0, Math.min(remaining, upper - lowerBound));
    tax += Math.round(slice * b.rate);
    remaining -= slice;
    lowerBound = upper;
    if (remaining <= 0) break;
  }
  return tax;
}

/**
 * Compute state income tax using real brackets when we have them for
 * the state, otherwise return null so the caller can fall back to the
 * flat-rate table.
 *
 * Returns { taxCents, note } where note is a one-line description of
 * which method / year was used so the engine can surface it as an
 * assumption.
 */
export function computeStateTaxFromBrackets(args: {
  taxableIncomeCents: number;
  filingStatus: FilingStatus;
  stateCode: string;
  taxYear: number;
}): { taxCents: number; note: string } | null {
  const stateUpper = args.stateCode.toUpperCase();
  const table = BRACKETS_BY_STATE[stateUpper];
  if (!table) return null;

  // Pick the right column. NJ/CA/NY/MN/OR/HI/MD/CT have separate MFJ
  // brackets; MA doesn't (flat). Everything else uses the "single"
  // column. Qualifying widow follows MFJ. MFS in most states uses
  // single brackets (NJ MFS gets the single column too).
  const isJoint =
    args.filingStatus === "married_filing_jointly" ||
    args.filingStatus === "qualifying_widow";
  const useMfjBrackets =
    isJoint && table.married_filing_jointly !== undefined;
  const brackets = useMfjBrackets
    ? (table.married_filing_jointly as StateBracket[])
    : table.single;

  let tax = applyBrackets(args.taxableIncomeCents, brackets);

  let surchargeNote = "";
  if (
    table.surcharge &&
    args.taxableIncomeCents > table.surcharge.threshold
  ) {
    const base = table.surcharge.onExcess
      ? args.taxableIncomeCents - table.surcharge.threshold
      : args.taxableIncomeCents;
    const surTax = Math.round(base * table.surcharge.rate);
    tax += surTax;
    surchargeNote = ` Plus $${(surTax / 100).toLocaleString()} from the ${stateUpper} high-income surcharge (${table.surcharge.note}).`;
  }

  // Be honest about which year of brackets we're using. Currently all
  // tables in this module are 2025; for a 2026 forecast we surface
  // that explicitly so the user knows it's a placeholder until the
  // state publishes 2026 figures (audit High #2: the footer said
  // "MN 2025 bracket table" inside a 2026 forecast with no context).
  const BRACKETS_DATA_YEAR = 2025;
  const bracketYearNote =
    args.taxYear === BRACKETS_DATA_YEAR
      ? `${BRACKETS_DATA_YEAR} bracket table`
      : `${BRACKETS_DATA_YEAR} bracket table, placeholder for ${args.taxYear} until ${stateUpper} publishes the year's brackets`;
  return {
    taxCents: tax,
    note: `State tax computed using ${stateUpper} ${bracketYearNote}${useMfjBrackets ? " (MFJ column)" : ""}.${surchargeNote}`,
  };
}
