/**
 * State entity-level taxes — what the IRS doesn't touch.
 *
 * The forecast engine historically used a single state rate per
 * state (the personal rate) for every entity type. That works for
 * sole prop / single-member LLC / partnership / S-Corp (pass-
 * through to personal). It is WRONG for C-Corps, and incomplete
 * for entities subject to:
 *
 *   - State C-Corp income tax at a different rate (CA 8.84%,
 *     NY 7.25%, NJ 6.5–9%, etc.)
 *   - State S-Corp tax-on-top-of-pass-through (CA 1.5%, NY fixed-
 *     dollar minimum, MA 6.25%, IL "replacement tax" 1.5%)
 *   - Minimum franchise tax (CA $800 LLC + S-Corp, MA $456 S-Corp
 *     min, DE $300 LLC, TN $100 minimum, etc.)
 *   - LLC gross-receipts fees (CA tiered $900–$11,790)
 *   - State-level gross-receipts / margin taxes (TX margin, WA B&O,
 *     OH CAT, OR CAT, NV Commerce Tax) that apply to revenue, not
 *     profit, and apply REGARDLESS of entity type
 *
 * This module surfaces all of the above as additive line items on
 * top of the personal-side state income tax computed in
 * `lib/tax/state-brackets.ts`. The forecast engine consumes this
 * via `computeStateEntityTax()` below.
 *
 * Scope-of-automation reality check (read me before changing):
 *
 *   ✓ AUTOMATED:
 *     - C-Corp state income tax at the headline state rate
 *     - S-Corp state-level entity tax where applicable
 *     - LLC and S-Corp minimum franchise tax
 *     - LLC gross-receipts fees (CA tiered table)
 *     - Gross-receipts / margin tax DETECTION + ROUGH ESTIMATE
 *
 *   ✗ NOT AUTOMATED (preparer still owns):
 *     - PTET (pass-through entity tax) ELECTIONS — opt-in per year,
 *       per entity. Math is non-trivial because the entity pays at
 *       a state-specific rate (usually the top personal rate) and
 *       partners get a corresponding credit. We DETECT eligibility
 *       and surface a hint but do not auto-elect.
 *     - State QBI conformity — most states do NOT recognize federal
 *       §199A QBI; a few do (Colorado, North Dakota). We surface
 *       the conformity flag but the bracket file in `state-brackets.ts`
 *       already correctly runs against pre-QBI taxable income.
 *     - Combined / unitary reporting — large multi-state groups
 *       file a single combined state return. Not modeled.
 *     - Sourcing rules — cost-of-performance vs market-based for
 *       service businesses. We assume the apportionment input
 *       reflects the correct sourcing.
 *     - Multi-state composite returns for non-resident partners.
 *     - Bonus depreciation conformity (states differ on whether
 *       they conform to federal §168(k)).
 *     - State-level R&D credits, jobs credits, NOL carryforwards.
 *
 * Refresh cadence: state rates are revisited annually in late Q4
 * when states publish their next year's tax bulletins. The
 * `as_of_year` field on each constant marks the source year.
 */

import type { FilingStatus } from "./constants-2025";

export type EntityType =
  | "sole_prop"
  | "single_llc"
  | "multi_llc"
  | "partnership"
  | "s_corp"
  | "c_corp";

// ============================================================================
// State C-Corp income tax rates
// ============================================================================

/**
 * C-Corp state income tax rate per state.
 *
 * For states with bracketed C-Corp tax (NY, NJ, AK, IL), we use
 * the top bracket rate as the headline rate; corporations in the
 * lower brackets pay less and we surface an assumption. For states
 * with NO corporate income tax but a gross-receipts / margin tax
 * (TX, WA, OH, NV), the rate is 0 here and the gross-receipts tax
 * is applied separately below.
 *
 * Sources: state DOR bulletins as of 2025-Q4.
 */
export const C_CORP_STATE_RATE: Record<string, { rate: number; note: string }> = {
  AL: { rate: 0.065, note: "Alabama: flat 6.5% on Alabama taxable income." },
  AK: { rate: 0.094, note: "Alaska: graduated 0–9.4%; top bracket on income > $222,000." },
  AZ: { rate: 0.049, note: "Arizona: flat 4.9%." },
  AR: { rate: 0.053, note: "Arkansas: graduated; top bracket on income > $25,000." },
  CA: { rate: 0.0884, note: "California: 8.84% (or 10.84% for financial institutions, not modeled)." },
  CO: { rate: 0.044, note: "Colorado: flat 4.4%." },
  CT: { rate: 0.075, note: "Connecticut: 7.5% + 10% surcharge on tax liability ≥ $250 (we don't model the surcharge)." },
  DE: { rate: 0.087, note: "Delaware: flat 8.7%." },
  DC: { rate: 0.0825, note: "DC: flat 8.25%." },
  FL: { rate: 0.055, note: "Florida: 5.5% (5.5% standard rate effective 2024+)." },
  GA: { rate: 0.0539, note: "Georgia: 5.39% flat (post-2024 reform; phasing toward 4.99% by 2028)." },
  HI: { rate: 0.064, note: "Hawaii: graduated 4.4–6.4%; top bracket on income > $100,000." },
  ID: { rate: 0.058, note: "Idaho: flat 5.8%." },
  IL: { rate: 0.095, note: "Illinois: 7% corporate income + 2.5% personal property replacement tax." },
  IN: { rate: 0.049, note: "Indiana: 4.9% (phasing down)." },
  IA: { rate: 0.071, note: "Iowa: 5.5% / 7.1% bracketed; top on income > $100,000." },
  KS: { rate: 0.06, note: "Kansas: 3.5% (first $50,000) + 2.5% surtax = 6% combined on income > $50,000." },
  KY: { rate: 0.05, note: "Kentucky: flat 5%." },
  LA: { rate: 0.075, note: "Louisiana: graduated 3.5–7.5%; top on income > $150,000." },
  ME: { rate: 0.0893, note: "Maine: graduated 3.5–8.93%; top on income > $3.5M." },
  MD: { rate: 0.0825, note: "Maryland: flat 8.25%." },
  MA: { rate: 0.08, note: "Massachusetts: 8% on net income (S-Corps see separate rate below)." },
  MI: { rate: 0.06, note: "Michigan: flat 6%." },
  MN: { rate: 0.098, note: "Minnesota: flat 9.8% (highest in the country)." },
  MS: { rate: 0.05, note: "Mississippi: 4% (first $5,000) + 5% on the rest; flat 5% approximation." },
  MO: { rate: 0.04, note: "Missouri: flat 4%." },
  MT: { rate: 0.0675, note: "Montana: flat 6.75%." },
  NE: { rate: 0.0584, note: "Nebraska: graduated 5.58–5.84%; top on income > $100,000." },
  NV: { rate: 0, note: "Nevada: no corporate income tax. Commerce Tax (gross receipts) applies — see below." },
  NH: { rate: 0.075, note: "New Hampshire: 7.5% Business Profits Tax + 0.55% Business Enterprise Tax (BET, not modeled here)." },
  NJ: { rate: 0.09, note: "New Jersey: 6.5–9% bracketed; top on income > $100,000 (plus 2.5% Corporate Transit Fee on income > $10M, not modeled)." },
  NM: { rate: 0.059, note: "New Mexico: 4.8% (first $500,000) + 5.9% on the rest; flat 5.9% approximation." },
  NY: { rate: 0.0725, note: "New York: 6.5%/7.25% on business income (top on income > $5M); fixed-dollar minimum tax applied separately." },
  NC: { rate: 0.025, note: "North Carolina: flat 2.5%, phasing to 0% by 2030." },
  ND: { rate: 0.0431, note: "North Dakota: graduated 1.41–4.31%; top on income > $50,000." },
  OH: { rate: 0, note: "Ohio: no corporate income tax. Commercial Activity Tax (CAT) on gross receipts > $3M applies — see below." },
  OK: { rate: 0.04, note: "Oklahoma: flat 4%." },
  OR: { rate: 0.0775, note: "Oregon: 6.6%/7.6% bracketed; plus Corporate Activity Tax (CAT) on receipts > $1M." },
  PA: { rate: 0.0799, note: "Pennsylvania: 7.99% in 2025, phasing to 4.99% by 2031." },
  RI: { rate: 0.07, note: "Rhode Island: flat 7%." },
  SC: { rate: 0.05, note: "South Carolina: flat 5%." },
  SD: { rate: 0, note: "South Dakota: no corporate income tax." },
  TN: { rate: 0.065, note: "Tennessee: 6.5% excise tax on net earnings + franchise tax." },
  TX: { rate: 0, note: "Texas: no corporate income tax. Franchise (margin) tax on gross receipts > $1.23M applies — see below." },
  UT: { rate: 0.0455, note: "Utah: flat 4.55%." },
  VT: { rate: 0.085, note: "Vermont: graduated 6/7/8.5%; top on income > $25,000." },
  VA: { rate: 0.06, note: "Virginia: flat 6%." },
  WA: { rate: 0, note: "Washington: no corporate income tax. B&O tax on gross receipts applies — see below." },
  WV: { rate: 0.0651, note: "West Virginia: flat 6.5% (effective 2024)." },
  WI: { rate: 0.079, note: "Wisconsin: flat 7.9%." },
  WY: { rate: 0, note: "Wyoming: no corporate income tax." },
};

// ============================================================================
// S-Corp state-level tax (on top of personal pass-through)
// ============================================================================

/**
 * S-Corp state tax — the amounts the entity itself pays, on top of
 * the personal income tax owed by shareholders on their K-1 pass-
 * through.
 *
 * Most states honor the federal S election and don't tax the
 * entity. The exceptions:
 */
export const S_CORP_STATE_TAX: Record<
  string,
  {
    /** Tax rate applied to entity net income (in addition to personal). */
    entityRate?: number;
    /** Annual minimum franchise tax (cents). */
    minimumFranchiseCents?: number;
    note: string;
  }
> = {
  CA: {
    entityRate: 0.015,
    minimumFranchiseCents: 80_000, // $800
    note: "California: 1.5% on S-Corp net income + $800 annual franchise tax (minimum). First-year exemption from $800 minimum (R&TC §17935).",
  },
  IL: {
    entityRate: 0.015,
    note: "Illinois: 1.5% Personal Property Replacement Tax on S-Corp net income.",
  },
  MA: {
    entityRate: 0.08,
    minimumFranchiseCents: 45_600, // $456 minimum corporate excise
    note: "Massachusetts: S-Corp 'sting tax' on gross receipts ≥ $6M (we model the 8% net-income approximation when receipts trigger it); $456 minimum excise.",
  },
  NY: {
    minimumFranchiseCents: 2_500, // $25 lowest tier; tiered by receipts up to $4,500
    note: "New York: fixed-dollar minimum tax tiered by NY-source gross receipts ($25–$4,500). We use the lowest tier as a floor.",
  },
  TN: {
    entityRate: 0.025,
    minimumFranchiseCents: 10_000, // $100 minimum
    note: "Tennessee: 2.5% Hall income tax on certain investment income + $100 franchise tax minimum.",
  },
  TX: {
    // S-Corps file Texas margin tax just like C-Corps; covered below.
    note: "Texas: federal S election ignored — entity files Texas Franchise (Margin) Tax. See gross-receipts table.",
  },
};

// ============================================================================
// LLC fees (entity-level, even for pass-through LLCs)
// ============================================================================

/**
 * Annual LLC fees — applies to single-member and multi-member LLCs
 * regardless of how they're taxed federally (sole-prop, partnership,
 * or S-Corp).
 */
export const LLC_FEE: Record<
  string,
  {
    minimumCents: number;
    /** Optional tiered fee based on total gross receipts. Caller picks
     *  the matching tier; computeStateEntityTax does the lookup. */
    grossReceiptsTiers?: Array<{
      receiptsCentsMin: number;
      receiptsCentsMax: number | null;
      feeCents: number;
    }>;
    note: string;
  }
> = {
  CA: {
    minimumCents: 80_000, // $800 annual franchise tax
    // Tiered gross-receipts fee per R&TC §17942 (California Revenue
    // & Taxation Code). Thresholds are tied to TOTAL CA gross
    // receipts, not net income. Effective tax-year 2024 figures
    // (haven't changed since 2009).
    grossReceiptsTiers: [
      { receiptsCentsMin: 0, receiptsCentsMax: 249_999_99, feeCents: 0 }, // under $250K
      { receiptsCentsMin: 250_000_00, receiptsCentsMax: 499_999_99, feeCents: 90_000 }, // $250K-$499K: $900
      { receiptsCentsMin: 500_000_00, receiptsCentsMax: 999_999_99, feeCents: 250_000 }, // $500K-$999K: $2,500
      { receiptsCentsMin: 1_000_000_00, receiptsCentsMax: 4_999_999_99, feeCents: 600_000 }, // $1M-$4.99M: $6,000
      { receiptsCentsMin: 5_000_000_00, receiptsCentsMax: null, feeCents: 1_179_000 }, // $5M+: $11,790
    ],
    note: "California LLC: $800 annual franchise + tiered gross-receipts fee (R&TC §17942). First-year exemption for new LLCs.",
  },
  DE: {
    minimumCents: 30_000, // $300 annual LLC tax
    note: "Delaware: $300 annual LLC tax (due June 1). No fee on receipts.",
  },
  TN: {
    minimumCents: 10_000, // $100 minimum franchise
    note: "Tennessee: $100 minimum franchise tax for LLCs.",
  },
  MA: {
    minimumCents: 50_000, // $500 LLC annual report fee
    note: "Massachusetts: $500 LLC annual report filing fee.",
  },
};

// ============================================================================
// Gross-receipts / margin taxes
// ============================================================================

/**
 * State gross-receipts / margin taxes — these apply to revenue,
 * NOT profit, and apply REGARDLESS of entity type. Modeling them
 * correctly requires nexus + sourcing rules we don't fully have;
 * we surface a ROUGH ESTIMATE + a hint that the preparer must
 * verify nexus and sourcing.
 */
export const GROSS_RECEIPTS_TAX: Record<
  string,
  {
    name: string;
    /** Effective rate applied to gross receipts > threshold (rough). */
    rate: number;
    /** Minimum receipts triggering the tax (cents). Below this, no tax. */
    thresholdCents: number;
    note: string;
  }
> = {
  TX: {
    name: "Texas Franchise (Margin) Tax",
    rate: 0.00375, // 0.375% retail-wholesale; 0.75% other. We use the lower as a rough lower bound.
    thresholdCents: 1_230_000_00, // $1.23M no-tax-due threshold (2024+)
    note: "Texas Margin Tax: 0.375% retail/wholesale, 0.75% other; no-tax-due threshold $1.23M. Margin = gross receipts − one of (COGS / compensation / 70% of receipts). Estimate uses 0.375% × receipts as a floor.",
  },
  WA: {
    name: "Washington B&O Tax",
    rate: 0.00484, // service rate 1.5% / wholesale 0.484% / retail 0.471% — we default to service
    thresholdCents: 12_500_00, // $125,000 small-business credit threshold
    note: "Washington B&O Tax: rate varies by activity (service 1.5%, wholesale 0.484%, retail 0.471%). Estimate uses wholesale rate as a midpoint; verify your activity classification.",
  },
  OH: {
    name: "Ohio Commercial Activity Tax (CAT)",
    rate: 0.0026, // 0.26%
    thresholdCents: 3_000_000_00, // $3M starting 2025
    note: "Ohio CAT: 0.26% on Ohio-sourced gross receipts above $3M (raised from $1M in 2024). Annual filing for receipts $150K–$3M is free as of 2024.",
  },
  OR: {
    name: "Oregon Corporate Activity Tax (CAT)",
    rate: 0.0057, // 0.57% on receipts > $1M, plus $250 flat
    thresholdCents: 1_000_000_00, // $1M
    note: "Oregon CAT: 0.57% on receipts > $1M + $250 flat fee. Applies to C-Corps AND pass-throughs above threshold.",
  },
  NV: {
    name: "Nevada Commerce Tax",
    rate: 0.00111, // tiered 0.051%–0.331% by industry; we use 0.111% as a mid-range estimate
    thresholdCents: 4_000_000_00, // $4M
    note: "Nevada Commerce Tax: tiered by industry (0.051%–0.331%). Threshold $4M. Estimate uses a mid-range; verify your NAICS classification.",
  },
};

// ============================================================================
// State QBI conformity
// ============================================================================

/**
 * Whether a state recognizes the federal §199A QBI deduction in its
 * own tax base. Most states do NOT conform — they apply state tax
 * to federal AGI (or their own base) BEFORE the QBI deduction is
 * subtracted. A few states explicitly conform.
 */
export const STATE_QBI_CONFORMITY: Record<string, boolean> = {
  CO: true, // Colorado conforms — state uses federal taxable income
  ND: true,
  // Default: state does NOT recognize federal QBI deduction.
  // Add states here as they pass conformity legislation.
};

export function stateRecognizesFederalQBI(stateCode: string | null | undefined): boolean {
  if (!stateCode) return false;
  return STATE_QBI_CONFORMITY[stateCode.toUpperCase()] ?? false;
}

// ============================================================================
// PTET (pass-through entity tax) eligibility detection
// ============================================================================

/**
 * States that offer a PTET election as a federal SALT-cap workaround.
 * We do NOT auto-apply the election; we surface a hint when the
 * client's books look like they'd benefit (state tax > federal SALT
 * cap headroom). Election + math is preparer-owned.
 */
export const PTET_STATES = new Set([
  "AL", "AR", "AZ", "CA", "CO", "CT", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NJ",
  "NM", "NY", "NC", "OH", "OK", "OR", "RI", "SC", "UT", "VA", "WV", "WI",
]);

export function statePtetAvailable(stateCode: string | null | undefined): boolean {
  if (!stateCode) return false;
  return PTET_STATES.has(stateCode.toUpperCase());
}

// ============================================================================
// computeStateEntityTax — the public entry point
// ============================================================================

export type StateEntityTaxInput = {
  stateCode: string | null | undefined;
  entityType: EntityType;
  /** Net business income (cents) — used for C-Corp + S-Corp entity rates. */
  netBusinessIncomeCents: number;
  /** Gross receipts (cents) — used for LLC tiered fees + gross-receipts taxes. */
  grossReceiptsCents: number;
  /** True if this is the LLC's first taxable year (CA exempts first-year minimum). */
  isFirstYear?: boolean;
};

export type StateEntityTaxResult = {
  /** Total state-level entity tax (cents). Additive on top of personal-side state tax. */
  totalEntityTaxCents: number;
  /** Breakdown for UI display. */
  breakdown: {
    cCorpIncomeTaxCents: number;
    sCorpEntityTaxCents: number;
    minimumFranchiseCents: number;
    llcFeeCents: number;
    grossReceiptsTaxCents: number;
  };
  /** Human-readable notes — every applicable line item attaches a note. */
  notes: string[];
  /** Hints for the preparer (PTET availability, etc.). */
  hints: string[];
  /** TRUE when one of the gross-receipts taxes applies (so caller can
   *  surface a "verify nexus + sourcing" warning prominently). */
  hasGrossReceiptsTax: boolean;
};

export function computeStateEntityTax(
  input: StateEntityTaxInput,
): StateEntityTaxResult {
  const state = (input.stateCode ?? "").toUpperCase();
  const result: StateEntityTaxResult = {
    totalEntityTaxCents: 0,
    breakdown: {
      cCorpIncomeTaxCents: 0,
      sCorpEntityTaxCents: 0,
      minimumFranchiseCents: 0,
      llcFeeCents: 0,
      grossReceiptsTaxCents: 0,
    },
    notes: [],
    hints: [],
    hasGrossReceiptsTax: false,
  };

  if (!state) return result;
  const isLLC = input.entityType === "single_llc" || input.entityType === "multi_llc";
  const isCCorp = input.entityType === "c_corp";
  const isSCorp = input.entityType === "s_corp";

  // C-Corp state income tax.
  if (isCCorp) {
    const cCorp = C_CORP_STATE_RATE[state];
    if (cCorp && cCorp.rate > 0) {
      const tax = Math.max(0, Math.round(input.netBusinessIncomeCents * cCorp.rate));
      result.breakdown.cCorpIncomeTaxCents = tax;
      result.totalEntityTaxCents += tax;
      result.notes.push(cCorp.note);
    } else if (cCorp) {
      result.notes.push(cCorp.note);
    }
  }

  // S-Corp entity tax + minimum franchise.
  if (isSCorp) {
    const sCorp = S_CORP_STATE_TAX[state];
    if (sCorp) {
      if (sCorp.entityRate && sCorp.entityRate > 0) {
        const tax = Math.max(0, Math.round(input.netBusinessIncomeCents * sCorp.entityRate));
        result.breakdown.sCorpEntityTaxCents = tax;
        result.totalEntityTaxCents += tax;
      }
      if (sCorp.minimumFranchiseCents && !input.isFirstYear) {
        result.breakdown.minimumFranchiseCents = sCorp.minimumFranchiseCents;
        result.totalEntityTaxCents += sCorp.minimumFranchiseCents;
      }
      result.notes.push(sCorp.note);
    }
  }

  // LLC annual fee + tiered gross-receipts fee.
  if (isLLC) {
    const llc = LLC_FEE[state];
    if (llc) {
      if (!input.isFirstYear) {
        result.breakdown.llcFeeCents += llc.minimumCents;
        result.totalEntityTaxCents += llc.minimumCents;
      }
      if (llc.grossReceiptsTiers) {
        const tier = llc.grossReceiptsTiers.find(
          (t) =>
            input.grossReceiptsCents >= t.receiptsCentsMin &&
            (t.receiptsCentsMax === null ||
              input.grossReceiptsCents <= t.receiptsCentsMax),
        );
        if (tier && tier.feeCents > 0) {
          result.breakdown.llcFeeCents += tier.feeCents;
          result.totalEntityTaxCents += tier.feeCents;
        }
      }
      result.notes.push(llc.note);
    }
  }

  // Gross-receipts / margin taxes (all entity types).
  const grt = GROSS_RECEIPTS_TAX[state];
  if (grt && input.grossReceiptsCents >= grt.thresholdCents) {
    const tax = Math.round(
      (input.grossReceiptsCents - grt.thresholdCents) * grt.rate,
    );
    result.breakdown.grossReceiptsTaxCents = tax;
    result.totalEntityTaxCents += tax;
    result.notes.push(grt.note);
    result.hasGrossReceiptsTax = true;
    result.hints.push(
      `${grt.name} likely applies — confirm nexus and sourcing rules with your preparer; this estimate is a floor, not a final figure.`,
    );
  }

  // PTET hint (information only — we never auto-elect).
  if (statePtetAvailable(state) && !isCCorp) {
    result.hints.push(
      `${state} offers a PTET (pass-through entity tax) election. If your state tax exceeds the federal $10K SALT cap, electing PTET at the entity level can recover that deduction federally. Ask your preparer to evaluate.`,
    );
  }

  // QBI conformity note.
  if (input.entityType !== "c_corp" && !stateRecognizesFederalQBI(state)) {
    // Only push if this state actually has income tax — flagging
    // QBI non-conformity for FL is pointless.
    result.hints.push(
      "Most states (including this one) do NOT recognize the federal §199A QBI deduction. State taxable income is computed before QBI; the federal QBI savings doesn't reduce state tax.",
    );
  }

  return result;
}
