import { forecast } from "@/lib/tax/forecast";
import { neutralForecastInput, toCents, US_STATES } from "./base-input";

/**
 * Per-state data for the programmatic "self-employment tax in {state}"
 * pages. The numbers are COMPUTED from the same forecast engine as the
 * calculators (real per-state brackets), so each page carries unique,
 * accurate figures — not a templated shell. That's what keeps 50+
 * generated pages substantive instead of thin doorway pages.
 */

const TAX_YEAR = 2026;

// Authoritative list of states with NO personal income tax on earned
// income (2026). NH taxes only interest/dividends (not wages/SE income)
// and TN repealed its Hall tax — both belong here for a self-employment
// page. Deriving this from the engine is unreliable: the engine can
// return a small non-income state figure (e.g. WA's business tax) that
// would wrongly flag a no-income-tax state, so we use the known list and
// compute those states with no state code (clean federal + SE only).
const NO_INCOME_TAX = new Set([
  "AK",
  "FL",
  "NV",
  "NH",
  "SD",
  "TN",
  "TX",
  "WA",
  "WY",
]);

export function stateHasIncomeTax(code: string): boolean {
  return !NO_INCOME_TAX.has(code);
}

export type CalcState = { code: string; name: string; slug: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// All 50 states + DC (drop the "" skip entry), each with a URL slug.
export const CALC_STATES: CalcState[] = US_STATES.filter((s) => s.code).map(
  (s) => ({ code: s.code, name: s.name, slug: slugify(s.name) }),
);

const BY_SLUG = new Map(CALC_STATES.map((s) => [s.slug, s]));

export function stateBySlug(slug: string): CalcState | undefined {
  return BY_SLUG.get(slug);
}

export type StateExample = {
  netDollars: number;
  totalTaxCents: number;
  stateTaxCents: number;
  effectiveRate: number;
};

export type StateSnapshot = {
  hasIncomeTax: boolean;
  /** The state's income-tax bite on a $100k single self-employed
   *  filer, as a percentage of income — a single comparable headline. */
  stateBiteAt100k: number;
  examples: StateExample[];
};

function runFor(code: string, net: number): StateExample {
  // For no-income-tax states, compute with no state code so the numbers
  // are the clean federal + SE figure the page promises (avoids a small
  // non-income state artifact contradicting the "no income tax" copy).
  const effectiveCode = stateHasIncomeTax(code) ? code : null;
  const r = forecast({
    ...neutralForecastInput(TAX_YEAR, "single"),
    stateCode: effectiveCode,
    ytdIncomeCents: toCents(net),
  });
  return {
    netDollars: net,
    totalTaxCents: r.totalTaxCents,
    stateTaxCents: r.stateTaxCents,
    effectiveRate: net > 0 ? r.totalTaxCents / toCents(net) : 0,
  };
}

export function stateSnapshot(code: string): StateSnapshot {
  const examples = [40_000, 75_000, 120_000].map((n) => runFor(code, n));
  const at100k = runFor(code, 100_000);
  return {
    hasIncomeTax: stateHasIncomeTax(code),
    stateBiteAt100k: at100k.stateTaxCents / toCents(100_000),
    examples,
  };
}
