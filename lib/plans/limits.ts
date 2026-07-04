/**
 * Plan limits, pricing, and credit economy.
 *
 * Five-tier ladder:
 *   filer    - W-2 / employed only, personal forecast (no company)
 *   solo     - 1099 / freelancer, single company
 *   studio   - growing SMB, multi-company + small team
 *   scale    - mid-market with bookkeeping needs
 *   practice - CPA / preparer firms (priced separately per # clients)
 *
 * `free` is preserved as a synonym for "no active subscription", anyone
 * without a paid tier defaults to free, which has the lowest caps and
 * cannot create a company. `team` is preserved as a legacy alias for
 * `studio` so old subscription rows don't break.
 *
 * Credit economy:
 *   - Every AI / OCR action consumes a fixed number of credits.
 *   - Each tier includes a monthly grant of credits (unused credits roll
 *     over up to 2× the grant; past that they evaporate at next grant).
 *   - Users can buy top-up packs to extend their balance without
 *     changing tier. Packs are capped at 3× the monthly grant per
 *     billing period to prevent low-tier users from buying their way
 *     into Scale-level usage.
 *   - Model access is tier-locked even if the user has the credits to
 *     pay for it: Filer → Haiku, Solo/Studio → Sonnet, Scale/Practice →
 *     Opus. Credits buy MORE of what your tier already unlocks; not
 *     access to a higher model.
 *
 * Cost grounding (per-credit):
 *   We sell credits at ~$0.04 average; each unit corresponds to ~$0.005
 *   of underlying model spend at Haiku rates. The markup pays for
 *   Stripe fees, headroom on bursty traffic, and the included monthly
 *   grant that gets eaten without any top-up revenue.
 */

export type Plan = "free" | "filer" | "solo" | "studio" | "scale" | "practice";

/**
 * Feature gates. true = the feature is available on this plan.
 *
 * `personalForecast` is the W-2 / employed product mode (no company
 * required). `bankConnect`, `multiCompany`, `teamChat`, `priorityModel`
 * etc. are graduated unlocks that justify higher tiers.
 */
export type FeatureGates = {
  /** Personal/W-2 forecast at /personal/forecast, no company. */
  personalForecast: boolean;
  /** Schedule C / business-side forecast at /c/[publicId]/forecast. */
  businessForecast: boolean;
  /** Ask Bella. Model used is gated by `bellaModel` below. */
  bella: boolean;
  /** Plaid live bank sync (institution count gated by PLAN_LIMITS). */
  bankConnect: boolean;
  /** CSV transaction import. */
  csvImport: boolean;
  /** Bulk CSV (≥ 1k rows) for high-volume importers. */
  csvBulk: boolean;
  /** Team chat tab (multi-user collaboration in a company). */
  teamChat: boolean;
  /** Add team members to a company. */
  inviteEmployees: boolean;
  /** Find / engage a tax preparer. */
  taxPreparer: boolean;
  /** Multiple companies (true means > 1; per-tier cap in PLAN_LIMITS). */
  multiCompany: boolean;
  /** Multi-state forecast (real bracket math when shipped). */
  multiState: boolean;
  /** Priority email / chat support. */
  prioritySupport: boolean;
  /** Audit support (IRS letter help, response drafts). */
  auditSupport: boolean;
  /** White-labeled PDF reports + custom domain (CPA practices). */
  whiteLabel: boolean;
  /** Public API access. */
  apiAccess: boolean;
  /** Firm preparer center / client portal. */
  preparerCenter: boolean;
};

/**
 * Bella model tier, controls which model the assistant can call.
 * Higher tiers unlock larger models. This is enforced server-side
 * regardless of credit balance.
 */
export type BellaModel = "haiku" | "sonnet" | "opus";

export const FEATURE_GATES: Record<Plan, FeatureGates> = {
  free: {
    personalForecast: false,
    businessForecast: false,
    bella: false,
    bankConnect: false,
    csvImport: false,
    csvBulk: false,
    teamChat: false,
    inviteEmployees: false,
    taxPreparer: false,
    multiCompany: false,
    multiState: false,
    prioritySupport: false,
    auditSupport: false,
    whiteLabel: false,
    apiAccess: false,
    preparerCenter: false,
  },
  filer: {
    personalForecast: true,
    businessForecast: false,
    bella: true,
    bankConnect: false,
    csvImport: false,
    csvBulk: false,
    teamChat: false,
    inviteEmployees: false,
    taxPreparer: true,
    multiCompany: false,
    multiState: false,
    prioritySupport: false,
    auditSupport: false,
    whiteLabel: false,
    apiAccess: false,
    preparerCenter: false,
  },
  solo: {
    personalForecast: true,
    businessForecast: true,
    bella: true,
    bankConnect: true,
    csvImport: true,
    csvBulk: false,
    teamChat: false,
    inviteEmployees: false,
    taxPreparer: true,
    multiCompany: false,
    multiState: false,
    prioritySupport: false,
    auditSupport: false,
    whiteLabel: false,
    apiAccess: false,
    preparerCenter: false,
  },
  studio: {
    personalForecast: true,
    businessForecast: true,
    bella: true,
    bankConnect: true,
    csvImport: true,
    csvBulk: true,
    teamChat: true,
    inviteEmployees: true,
    taxPreparer: true,
    multiCompany: true,
    multiState: true,
    prioritySupport: false,
    auditSupport: false,
    whiteLabel: false,
    apiAccess: false,
    preparerCenter: false,
  },
  scale: {
    personalForecast: true,
    businessForecast: true,
    bella: true,
    bankConnect: true,
    csvImport: true,
    csvBulk: true,
    teamChat: true,
    inviteEmployees: true,
    taxPreparer: true,
    multiCompany: true,
    multiState: true,
    prioritySupport: true,
    auditSupport: true,
    whiteLabel: true,
    apiAccess: true,
    preparerCenter: false,
  },
  practice: {
    personalForecast: true,
    businessForecast: true,
    bella: true,
    bankConnect: true,
    csvImport: true,
    csvBulk: true,
    teamChat: true,
    inviteEmployees: true,
    taxPreparer: true,
    multiCompany: true,
    multiState: true,
    prioritySupport: true,
    auditSupport: true,
    whiteLabel: true,
    apiAccess: true,
    preparerCenter: true,
  },
};

export const BELLA_MODEL_BY_PLAN: Record<Plan, BellaModel | null> = {
  free: null,
  filer: "haiku",
  solo: "sonnet",
  studio: "sonnet",
  scale: "opus",
  practice: "opus",
};

/**
 * Per-tier numeric caps. Infinity = no cap on that axis.
 *
 * `monthlyCreditGrant` is the credit allowance refreshed on each
 * billing cycle (or once per calendar month for free/super-admin).
 *
 * `bankInstitutions` is hard-capped at the Plaid level (we cap how
 * many distinct items can be linked simultaneously).
 */
export const PLAN_LIMITS = {
  free: {
    monthlyCreditGrant: 0,
    companies: 1,
    invitesPerCompany: 0,
    bankInstitutions: 0,
    csvImportsPerMonth: 0,
    receiptsPerMonth: 0,
  },
  filer: {
    monthlyCreditGrant: 30,
    companies: 0,
    invitesPerCompany: 0,
    bankInstitutions: 0,
    csvImportsPerMonth: 0,
    receiptsPerMonth: 10,
  },
  solo: {
    monthlyCreditGrant: 400,
    companies: 1,
    invitesPerCompany: 0,
    bankInstitutions: 1,
    csvImportsPerMonth: 5,
    receiptsPerMonth: 100,
  },
  studio: {
    monthlyCreditGrant: 1_500,
    companies: 3,
    invitesPerCompany: 5,
    bankInstitutions: 3,
    csvImportsPerMonth: 20,
    receiptsPerMonth: 500,
  },
  scale: {
    monthlyCreditGrant: 5_000,
    companies: 10,
    invitesPerCompany: 25,
    bankInstitutions: Number.POSITIVE_INFINITY,
    csvImportsPerMonth: Number.POSITIVE_INFINITY,
    receiptsPerMonth: 5_000,
  },
  practice: {
    monthlyCreditGrant: 15_000,
    companies: Number.POSITIVE_INFINITY,
    invitesPerCompany: Number.POSITIVE_INFINITY,
    bankInstitutions: Number.POSITIVE_INFINITY,
    csvImportsPerMonth: Number.POSITIVE_INFINITY,
    receiptsPerMonth: Number.POSITIVE_INFINITY,
  },
} as const;

export type PlanLimits = (typeof PLAN_LIMITS)[Plan];

/**
 * Subscription pricing, monthly + yearly per tier. Yearly = ~17% off
 * (≈ two months free) which is the conventional anchor users expect.
 */
export const PLAN_PRICING = {
  filer_monthly: {
    label: "Filer monthly",
    amountCents: 4_99,
    interval: "month" as const,
    plan: "filer" as Plan,
  },
  filer_yearly: {
    label: "Filer yearly",
    amountCents: 49_00,
    interval: "year" as const,
    plan: "filer" as Plan,
  },
  solo_monthly: {
    label: "Solo monthly",
    amountCents: 19_99,
    interval: "month" as const,
    plan: "solo" as Plan,
  },
  solo_yearly: {
    label: "Solo yearly",
    amountCents: 199_00,
    interval: "year" as const,
    plan: "solo" as Plan,
  },
  studio_monthly: {
    label: "Studio monthly",
    amountCents: 49_00,
    interval: "month" as const,
    plan: "studio" as Plan,
  },
  studio_yearly: {
    label: "Studio yearly",
    amountCents: 490_00,
    interval: "year" as const,
    plan: "studio" as Plan,
  },
  scale_monthly: {
    label: "Scale monthly",
    amountCents: 129_00,
    interval: "month" as const,
    plan: "scale" as Plan,
  },
  scale_yearly: {
    label: "Scale yearly",
    amountCents: 1_290_00,
    interval: "year" as const,
    plan: "scale" as Plan,
  },
  practice_monthly: {
    label: "Practice monthly",
    amountCents: 299_00,
    interval: "month" as const,
    plan: "practice" as Plan,
  },
  practice_yearly: {
    label: "Practice yearly",
    amountCents: 2_990_00,
    interval: "year" as const,
    plan: "practice" as Plan,
  },
} as const;

export type SubscriptionPriceKey = keyof typeof PLAN_PRICING;

/**
 * Top-up credit packs. Volume discounts nudge committed users into the
 * larger packs; even the largest pack ships at >50% gross margin.
 */
export const CREDIT_PACKS = {
  boost: {
    label: "Boost",
    credits: 100,
    amountCents: 5_00,
    pitch: "For occasional bursts.",
  },
  stack: {
    label: "Stack",
    credits: 500,
    amountCents: 20_00,
    pitch: "Most popular. ~20% better value.",
  },
  bundle: {
    label: "Bundle",
    credits: 1_500,
    amountCents: 50_00,
    pitch: "Power-user pack. ~33% better.",
  },
  power: {
    label: "Power",
    credits: 5_000,
    amountCents: 150_00,
    pitch: "For heavy months. ~40% better.",
  },
} as const;

export type CreditPackKey = keyof typeof CREDIT_PACKS;

/** All Stripe-billable price keys (subscriptions + one-shot top-ups). */
export type PriceKey = SubscriptionPriceKey | `topup_${CreditPackKey}`;

/**
 * Maximum top-up credits a user can purchase per billing period,
 * expressed as a multiple of the tier's monthly grant. Caps low-tier
 * users from operating at higher-tier volume via top-ups alone.
 */
export const TOPUP_CAP_MULTIPLIER = 3;

/**
 * Rollover policy: unused MONTHLY-GRANT credits roll forward up to
 * `rolloverMultiplier × monthlyGrant`. Past that, surplus monthly
 * credits expire on next grant. Top-up credits never expire (until
 * the user cancels).
 */
export const CREDIT_ROLLOVER_MULTIPLIER = 2;

/**
 * Per-action credit cost. The numbers reflect rough underlying cost at
 * 6× markup for Haiku, 3× for Sonnet, 2.5× for Opus, plus enough
 * buffer for retries and burst pricing.
 */
export const CREDIT_COST = {
  bella_haiku: 1,
  bella_sonnet: 4,
  bella_opus: 12,
  receipt_ocr: 2,
  document_ocr: 5,
  yearend_pdf: 3,
  // One Sonnet call categorizing an imported batch (up to ~200 rows
  // per call; the action chunks larger imports into multiple charges).
  bulk_categorize: 10,
} as const;

export type CreditAction = keyof typeof CREDIT_COST;

export function bellaCreditCost(model: BellaModel): number {
  return CREDIT_COST[`bella_${model}` as const];
}

export function isUnlimited(n: number): boolean {
  return !Number.isFinite(n);
}

export function formatLimit(n: number): string {
  return isUnlimited(n) ? "Unlimited" : String(n);
}

/**
 * Order tiers from cheapest to most premium. Used for "your plan
 * doesn't include X, upgrade to Y" prompts where we want the
 * smallest tier that unlocks the missing feature.
 */
export const PLAN_ORDER: readonly Plan[] = [
  "free",
  "filer",
  "solo",
  "studio",
  "scale",
  "practice",
] as const;

/**
 * Smallest paid tier that grants `feature`. Returns null if no tier
 * grants it (shouldn't happen with current FEATURE_GATES).
 */
export function smallestTierWith(feature: keyof FeatureGates): Plan | null {
  for (const plan of PLAN_ORDER) {
    if (plan === "free") continue;
    if (FEATURE_GATES[plan][feature]) return plan;
  }
  return null;
}

/**
 * Pretty label for a plan code.
 */
export function planLabel(plan: Plan): string {
  return {
    free: "Free",
    filer: "Filer",
    solo: "Solo",
    studio: "Studio",
    scale: "Scale",
    practice: "Practice",
  }[plan];
}
