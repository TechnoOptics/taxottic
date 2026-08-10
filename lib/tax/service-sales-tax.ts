/**
 * Sales-tax nexus + service-taxability module.
 *
 * The forecast engine handles INCOME tax. This module handles the
 * separate-but-equally-important question: "if I'm a freelancer or
 * firm based in State A and I sell services to clients in State B,
 * do I owe sales tax in State B, and how much?"
 *
 * The post-Wayfair (South Dakota v. Wayfair, Inc., 138 S. Ct. 2080
 * (2018)) regime made every state's economic-nexus thresholds the
 * binding test. If you exceed the threshold in a state, even
 * with zero physical presence there, you have nexus and must
 * collect / remit. Physical presence (an office, an employee, an
 * inventory location) ALSO creates nexus regardless of revenue.
 *
 * Service taxability is the second layer. Most states tax tangible
 * personal property but NOT services. Five states tax services
 * broadly via a gross-receipts-tax model (HI GET, NM GRT, SD,
 * WV, WA B&O). Other states tax SPECIFIC enumerated services. SaaS
 * is its own special case, about 24 states tax SaaS as either
 * tangible personal property or as an enumerated service.
 *
 * Scope of automation:
 *
 *   ✓ AUTOMATED:
 *     - Per-state economic-nexus thresholds (Wayfair-era)
 *     - "Are you over threshold in state X" detection
 *     - Service-taxability classification:
 *         general_taxable / saas_taxable / digital_taxable / exempt
 *     - Rough sales-tax estimate for taxable scenarios
 *     - "You should register here" flags
 *
 *   ✗ NOT AUTOMATED (preparer / sales-tax-software owns):
 *     - Actual sourcing math (destination vs origin per state)
 *     - Local tax overlays (avg overall rate used; not per-ZIP)
 *     - Marketplace facilitator status (Amazon/eBay/etc. collect
 *       for you on those platforms)
 *     - Resale / exempt certificates from B2B customers
 *     - Use-tax obligation on purchases (separate flow)
 *     - SST (Streamlined Sales Tax) simplified registration
 *     - Foreign / cross-border (we only model US states)
 *
 * Caveat: sales tax is the single most-changing tax in the country.
 * Thresholds, rates, and taxability rules shift every year per
 * state legislative session. This module's values are as of 2025;
 * always verify against the state's DOR / Streamlined Sales Tax
 * Governing Board before relying on them for actual filing.
 */

export const SALES_TAX_AS_OF_YEAR = 2025;

// ============================================================================
// Economic-nexus thresholds (post-Wayfair, 2018)
// ============================================================================

/**
 * Per-state economic-nexus thresholds.
 *
 * The Wayfair-era rule is: you have economic nexus if you exceed
 * EITHER (a) the dollar threshold of sales into the state in the
 * current or previous calendar year, OR (b) the transaction-count
 * threshold (where the state uses one). About a dozen states have
 * dropped the transaction-count test as too administratively
 * burdensome; the dollar threshold is the universally applicable
 * gate.
 *
 * Most states landed on $100,000 OR 200 transactions (the South
 * Dakota model). Larger states use higher dollar thresholds (CA,
 * NY, TX = $500K). MA and NJ landed at $100K (no transactions).
 * KS has no transaction threshold and dropped to a $100K trigger.
 */
export const ECONOMIC_NEXUS: Record<
  string,
  {
    /** Dollar threshold of sales INTO the state (cents). */
    salesThresholdCents: number;
    /** Transaction count threshold; null means no transaction trigger. */
    transactionThreshold: number | null;
    /** "calendar" = both current and prior calendar year; "trailing12"
     *  = rolling 12-month window; "prior" = previous year only. */
    measurementWindow: "calendar" | "trailing12" | "prior";
    note: string;
  }
> = {
  AL: { salesThresholdCents: 25_000_000, transactionThreshold: null, measurementWindow: "prior", note: "Alabama: $250,000 prior-year sales." },
  AK: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "prior", note: "Alaska: state has no statewide sales tax, but local jurisdictions ($100K/200 trigger via the Alaska Remote Seller Sales Tax Commission)." },
  AZ: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "prior", note: "Arizona: $100K prior-year." },
  AR: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Arkansas: $100K OR 200 transactions." },
  CA: { salesThresholdCents: 50_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "California: $500K sales (no transaction count)." },
  CO: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Colorado: $100K." },
  CT: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "trailing12", note: "Connecticut: $100K AND 200 transactions (BOTH required)." },
  DC: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "DC: $100K OR 200 transactions." },
  DE: { salesThresholdCents: 0, transactionThreshold: null, measurementWindow: "calendar", note: "Delaware: no statewide sales tax; gross receipts tax instead." },
  FL: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Florida: $100K." },
  GA: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Georgia: $100K OR 200 transactions." },
  HI: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Hawaii: $100K OR 200 transactions. GET applies to most services." },
  ID: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Idaho: $100K." },
  IL: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Illinois: $100K OR 200 transactions." },
  IN: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Indiana: $100K (dropped 200-transaction trigger 2024)." },
  IA: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Iowa: $100K." },
  KS: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Kansas: $100K." },
  KY: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Kentucky: $100K OR 200 transactions." },
  LA: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Louisiana: $100K (dropped 200-transaction trigger 2023)." },
  ME: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Maine: $100K (dropped 200-transaction trigger 2022)." },
  MD: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Maryland: $100K OR 200 transactions." },
  MA: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "prior", note: "Massachusetts: $100K (no transaction trigger)." },
  MI: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "prior", note: "Michigan: $100K OR 200 transactions." },
  MN: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "trailing12", note: "Minnesota: $100K OR 200 transactions (rolling 12 mos)." },
  MS: { salesThresholdCents: 25_000_000, transactionThreshold: null, measurementWindow: "trailing12", note: "Mississippi: $250K (rolling 12 mos)." },
  MO: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Missouri: $100K (added economic nexus 2023)." },
  MT: { salesThresholdCents: 0, transactionThreshold: null, measurementWindow: "calendar", note: "Montana: no statewide sales tax. Resort areas have local lodging/sales tax." },
  NE: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Nebraska: $100K OR 200 transactions." },
  NV: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Nevada: $100K OR 200 transactions." },
  NH: { salesThresholdCents: 0, transactionThreshold: null, measurementWindow: "calendar", note: "New Hampshire: no statewide sales tax." },
  NJ: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "New Jersey: $100K OR 200 transactions." },
  NM: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "prior", note: "New Mexico: $100K prior-year. Gross Receipts Tax applies to most services." },
  NY: { salesThresholdCents: 50_000_000, transactionThreshold: 100, measurementWindow: "trailing12", note: "New York: $500K AND 100 transactions (BOTH required, rolling 12 mos)." },
  NC: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "North Carolina: $100K (dropped 200-transaction trigger 2024)." },
  ND: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "North Dakota: $100K." },
  OH: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Ohio: $100K OR 200 transactions (CAT applies separately to gross receipts)." },
  OK: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Oklahoma: $100K." },
  OR: { salesThresholdCents: 0, transactionThreshold: null, measurementWindow: "calendar", note: "Oregon: no statewide sales tax. Oregon CAT applies separately to gross receipts." },
  PA: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Pennsylvania: $100K." },
  RI: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Rhode Island: $100K OR 200 transactions." },
  SC: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "South Carolina: $100K." },
  SD: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "South Dakota: $100K (the original Wayfair test, dropped 200-transaction trigger 2023). Most services taxable." },
  TN: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "prior", note: "Tennessee: $100K (dropped 200-transaction trigger 2020)." },
  TX: { salesThresholdCents: 50_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Texas: $500K." },
  UT: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Utah: $100K OR 200 transactions." },
  VT: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "prior", note: "Vermont: $100K OR 200 transactions." },
  VA: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Virginia: $100K OR 200 transactions." },
  WA: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Washington: $100K (B&O tax separately applies)." },
  WV: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "West Virginia: $100K OR 200 transactions. Most services taxable." },
  WI: { salesThresholdCents: 10_000_000, transactionThreshold: null, measurementWindow: "calendar", note: "Wisconsin: $100K (dropped 200-transaction trigger 2021)." },
  WY: { salesThresholdCents: 10_000_000, transactionThreshold: 200, measurementWindow: "calendar", note: "Wyoming: $100K OR 200 transactions." },
};

// ============================================================================
// Service taxability classification
// ============================================================================

/**
 * Categories of services as they map to state taxability rules.
 *
 *   professional      - accounting, legal, consulting, design, writing,
 *                       development services. Usually EXEMPT except in
 *                       the broad-base service-tax states.
 *   saas              - Software as a Service (online software access).
 *                       Taxable in about 24 states.
 *   digital_goods     - Downloads (e-books, music, software downloads,
 *                       digital photos). Taxable in ~35 states.
 *   installation      - Installation of tangible goods. Often taxable
 *                       when the underlying good is.
 *   repair            - Repair / maintenance services. State-specific.
 *   personal          - Hair/nails/cleaning. Mostly exempt but a few
 *                       states tax (HI, NM, SD, WV, etc.).
 *   landscaping       - Often taxable (HI, NM, NY, NJ, OH, etc.)
 */
export type ServiceCategory =
  | "professional"
  | "saas"
  | "digital_goods"
  | "installation"
  | "repair"
  | "personal"
  | "landscaping";

/**
 * Per-state, per-category service taxability.
 *
 *   true  = taxable; collect sales tax at state base rate
 *   false = exempt
 *
 * Sources: Avalara/TaxJar service-taxability matrices + state DOR
 * publications as of 2025. SaaS taxability is the most-changing
 * area; re-verify SaaS specifically before relying on a forecast.
 */
const SERVICE_TAXABILITY: Record<string, Partial<Record<ServiceCategory, boolean>>> = {
  // Broad-base service-tax states (most services taxable):
  HI: { professional: true, saas: true, digital_goods: true, installation: true, repair: true, personal: true, landscaping: true },
  NM: { professional: true, saas: true, digital_goods: true, installation: true, repair: true, personal: true, landscaping: true },
  SD: { professional: true, saas: true, digital_goods: true, installation: true, repair: true, personal: true, landscaping: true },
  WV: { professional: true, saas: true, digital_goods: true, installation: true, repair: true, personal: false, landscaping: true },
  WA: { professional: false, saas: true, digital_goods: true, installation: true, repair: true, personal: false, landscaping: true }, // B&O is separate; sales tax is on goods + listed services

  // States that broadly tax SaaS:
  AL: { professional: false, saas: true, digital_goods: true, installation: true, repair: false, personal: false, landscaping: false },
  AZ: { professional: false, saas: true, digital_goods: true, installation: true, repair: false, personal: false, landscaping: false },
  CT: { professional: false, saas: true, digital_goods: true, installation: true, repair: true, personal: false, landscaping: true },
  DC: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  IA: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  KY: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  LA: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  MA: { professional: false, saas: true, digital_goods: false, installation: true, repair: false, personal: false, landscaping: false },
  MD: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  MN: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  MS: { professional: false, saas: true, digital_goods: true, installation: true, repair: true, personal: false, landscaping: false },
  NE: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  NY: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: true },
  OH: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: true },
  PA: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  RI: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  TN: { professional: false, saas: true, digital_goods: true, installation: false, repair: true, personal: false, landscaping: false },
  TX: { professional: false, saas: true, digital_goods: true, installation: true, repair: true, personal: false, landscaping: true },
  UT: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  VT: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  WI: { professional: false, saas: true, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },

  // States that exempt SaaS but tax digital goods:
  AR: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  CO: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  GA: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  ID: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  IN: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  KS: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  ME: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  MI: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  NC: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  ND: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  NJ: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: true },
  OK: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  SC: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  VA: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },
  WY: { professional: false, saas: false, digital_goods: true, installation: false, repair: false, personal: false, landscaping: false },

  // States with no statewide sales tax:
  AK: { professional: false, saas: false, digital_goods: false, installation: false, repair: false, personal: false, landscaping: false },
  DE: { professional: false, saas: false, digital_goods: false, installation: false, repair: false, personal: false, landscaping: false },
  MT: { professional: false, saas: false, digital_goods: false, installation: false, repair: false, personal: false, landscaping: false },
  NH: { professional: false, saas: false, digital_goods: false, installation: false, repair: false, personal: false, landscaping: false },
  OR: { professional: false, saas: false, digital_goods: false, installation: false, repair: false, personal: false, landscaping: false },

  // States that don't tax SaaS or digital goods broadly:
  CA: { professional: false, saas: false, digital_goods: false, installation: true, repair: false, personal: false, landscaping: false }, // CA exempts SaaS + digital goods
  FL: { professional: false, saas: false, digital_goods: false, installation: true, repair: false, personal: false, landscaping: false },
  IL: { professional: false, saas: false, digital_goods: false, installation: false, repair: false, personal: false, landscaping: false }, // Chicago has a separate tax
  MO: { professional: false, saas: false, digital_goods: false, installation: false, repair: false, personal: false, landscaping: false },
  NV: { professional: false, saas: false, digital_goods: false, installation: false, repair: false, personal: false, landscaping: false },
};

/**
 * Per-state base sales-tax rate (the state-level component; local
 * jurisdiction overlays not included). Mirrors the DB-seeded
 * `sales_tax_state_rates` table, duplicated in code so the engine
 * can run without DB access.
 */
export const STATE_BASE_SALES_TAX_RATE: Record<string, number> = {
  AL: 0.04, AK: 0, AZ: 0.056, AR: 0.065, CA: 0.0725,
  CO: 0.029, CT: 0.0635, DC: 0.06, DE: 0, FL: 0.06,
  GA: 0.04, HI: 0.04, ID: 0.06, IL: 0.0625, IN: 0.07,
  IA: 0.06, KS: 0.065, KY: 0.06, LA: 0.0445, ME: 0.055,
  MD: 0.06, MA: 0.0625, MI: 0.06, MN: 0.06875, MS: 0.07,
  MO: 0.04225, MT: 0, NE: 0.055, NV: 0.0685, NH: 0,
  NJ: 0.06625, NM: 0.04875, NY: 0.04, NC: 0.0475, ND: 0.05,
  OH: 0.0575, OK: 0.045, OR: 0, PA: 0.06, RI: 0.07,
  SC: 0.06, SD: 0.042, TN: 0.07, TX: 0.0625, UT: 0.0485,
  VT: 0.06, VA: 0.053, WA: 0.065, WV: 0.06, WI: 0.05,
  WY: 0.04,
};

// ============================================================================
// Public API
// ============================================================================

export type ServiceSalesInState = {
  /** State the customer is in. */
  stateCode: string;
  /** Gross receipts billed into the state (cents). */
  grossReceiptsCents: number;
  /** Number of separate transactions (invoices) for the year. */
  transactionCount: number;
  /** Service category for taxability lookup. */
  category: ServiceCategory;
};

export type StateNexusResult = {
  stateCode: string;
  /** Does the business have economic nexus in this state under
   *  Wayfair-era rules? */
  hasEconomicNexus: boolean;
  /** Is this service category taxable in this state? */
  serviceTaxable: boolean;
  /** Estimated sales tax owed for the year (cents) if both conditions
   *  hold. Otherwise 0. */
  estimatedTaxOwedCents: number;
  /** Base state sales-tax rate used for the estimate. */
  baseRate: number;
  notes: string[];
  hints: string[];
};

export type ServiceSalesTaxResult = {
  /** Per-state breakdown. */
  states: StateNexusResult[];
  /** Total sales tax owed across all states with nexus (cents). */
  totalTaxOwedCents: number;
  /** States where the business HAS nexus but service is exempt -
   *  no tax owed, but registration may still be required. */
  nexusExemptStates: string[];
  /** States where the business is APPROACHING the threshold
   *  (80%+ of the dollar threshold), register-soon warning. */
  approachingThresholdStates: string[];
  /** Master hint list (collected from per-state results). */
  hints: string[];
};

export type ComputeServiceSalesTaxInput = {
  /** The business's home / domicile state. Always has nexus there. */
  homeStateCode: string;
  /** Service revenue broken out by destination state. */
  salesByState: ServiceSalesInState[];
};

/**
 * Compute the per-state nexus + sales-tax estimate for a service
 * business selling across state lines.
 *
 * The home state is always included with nexus = true regardless of
 * thresholds (physical-presence nexus). Other states are checked
 * against the post-Wayfair economic-nexus thresholds.
 */
export function computeServiceSalesTax(
  input: ComputeServiceSalesTaxInput,
): ServiceSalesTaxResult {
  const result: ServiceSalesTaxResult = {
    states: [],
    totalTaxOwedCents: 0,
    nexusExemptStates: [],
    approachingThresholdStates: [],
    hints: [],
  };
  const homeState = input.homeStateCode.toUpperCase();

  // Build the set of states to evaluate: home state + every state
  // with sales. Home state with zero sales still gets evaluated
  // because the business is physically based there.
  const stateMap = new Map<string, ServiceSalesInState>();
  for (const s of input.salesByState) {
    const code = s.stateCode.toUpperCase();
    const existing = stateMap.get(code);
    if (existing) {
      // Sum across categories if multiple rows for the same state.
      stateMap.set(code, {
        ...existing,
        grossReceiptsCents:
          existing.grossReceiptsCents + s.grossReceiptsCents,
        transactionCount: existing.transactionCount + s.transactionCount,
      });
    } else {
      stateMap.set(code, { ...s, stateCode: code });
    }
  }
  if (!stateMap.has(homeState)) {
    stateMap.set(homeState, {
      stateCode: homeState,
      grossReceiptsCents: 0,
      transactionCount: 0,
      category: "professional",
    });
  }

  for (const [code, sale] of stateMap.entries()) {
    const stateResult: StateNexusResult = {
      stateCode: code,
      hasEconomicNexus: false,
      serviceTaxable: false,
      estimatedTaxOwedCents: 0,
      baseRate: STATE_BASE_SALES_TAX_RATE[code] ?? 0,
      notes: [],
      hints: [],
    };

    // Home state always has nexus.
    const isHome = code === homeState;
    const nexusCfg = ECONOMIC_NEXUS[code];

    if (isHome) {
      stateResult.hasEconomicNexus = true;
      stateResult.notes.push(
        `${code}: home / domicile state, nexus applies regardless of revenue (physical presence).`,
      );
    } else if (nexusCfg) {
      const overDollarThreshold =
        sale.grossReceiptsCents >= nexusCfg.salesThresholdCents &&
        nexusCfg.salesThresholdCents > 0;
      const overTxnThreshold =
        nexusCfg.transactionThreshold !== null &&
        sale.transactionCount >= nexusCfg.transactionThreshold;
      stateResult.hasEconomicNexus =
        overDollarThreshold || overTxnThreshold;
      if (stateResult.hasEconomicNexus) {
        stateResult.notes.push(nexusCfg.note);
      } else if (
        nexusCfg.salesThresholdCents > 0 &&
        sale.grossReceiptsCents >= Math.floor(nexusCfg.salesThresholdCents * 0.8)
      ) {
        result.approachingThresholdStates.push(code);
        stateResult.hints.push(
          `${code}: approaching the economic-nexus threshold (${
            Math.round(
              (sale.grossReceiptsCents / nexusCfg.salesThresholdCents) * 100,
            )
          }% of $${(nexusCfg.salesThresholdCents / 100).toLocaleString("en-US")}). Register proactively before you cross.`,
        );
      }
    }

    // Service taxability.
    const taxability = SERVICE_TAXABILITY[code];
    stateResult.serviceTaxable = taxability?.[sale.category] ?? false;

    if (stateResult.hasEconomicNexus && stateResult.serviceTaxable) {
      stateResult.estimatedTaxOwedCents = Math.round(
        sale.grossReceiptsCents * stateResult.baseRate,
      );
      result.totalTaxOwedCents += stateResult.estimatedTaxOwedCents;
      stateResult.hints.push(
        `${code}: ${sale.category} services are TAXABLE here at ${(stateResult.baseRate * 100).toFixed(3)}% state base rate (local overlays not included). Estimated tax owed: $${(stateResult.estimatedTaxOwedCents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}.`,
      );
    } else if (stateResult.hasEconomicNexus && !stateResult.serviceTaxable) {
      result.nexusExemptStates.push(code);
      stateResult.hints.push(
        `${code}: you have nexus but ${sale.category} services are exempt, no sales tax owed on this revenue. Registration may still be required to file a zero-tax return; verify with the state.`,
      );
    }

    result.states.push(stateResult);
  }

  // Collect hints at the top level for easy UI surfacing.
  for (const s of result.states) {
    for (const h of s.hints) result.hints.push(h);
  }

  // Universal disclaimer.
  result.hints.push(
    "Sales-tax rates + thresholds change frequently. The figures above are as of " +
      SALES_TAX_AS_OF_YEAR +
      " and exclude local (city/county) overlays. Use a sales-tax automation service (Avalara, TaxJar, Stripe Tax) for production-grade compliance.",
  );

  return result;
}

/**
 * Convenience: check just nexus for a single state. Useful for UI
 * banners that ask "do I owe sales tax in Texas?".
 */
export function checkStateNexus(
  stateCode: string,
  grossReceiptsCents: number,
  transactionCount: number,
): { hasEconomicNexus: boolean; threshold: typeof ECONOMIC_NEXUS[string] | null } {
  const code = stateCode.toUpperCase();
  const cfg = ECONOMIC_NEXUS[code];
  if (!cfg) return { hasEconomicNexus: false, threshold: null };
  const overDollar =
    grossReceiptsCents >= cfg.salesThresholdCents && cfg.salesThresholdCents > 0;
  const overTxn =
    cfg.transactionThreshold !== null &&
    transactionCount >= cfg.transactionThreshold;
  return { hasEconomicNexus: overDollar || overTxn, threshold: cfg };
}
