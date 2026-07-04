import type { ForecastInput } from "@/lib/tax/forecast";
import type { FilingStatus } from "@/lib/tax/constants-2025";

/**
 * Neutral ForecastInput for the public calculators.
 *
 * The forecast engine (lib/tax/forecast.ts) takes ~25 fields; a public
 * calculator only asks the visitor a handful. This returns everything
 * zeroed / off so a calculator can spread it and override just the
 * inputs it collects, keeping each calculator component free of the
 * big boilerplate object and keeping them consistent with each other.
 *
 * Pure + client-safe (forecast.ts only imports pure tax-math modules).
 */
export function neutralForecastInput(
  taxYear: number,
  filingStatus: FilingStatus = "single",
): ForecastInput {
  return {
    taxYear,
    filingStatus,
    stateCode: null,
    age: null,
    isBlind: false,
    itemize: false,
    dependents: 0,
    dependentsUnder17: 0,
    spouseIncomeCents: 0,
    estimatedPaymentsCents: 0,
    ownerW2WagesCents: 0,
    ownerW2WithheldCents: 0,
    ownerW2SsWagesCents: 0,
    spouseW2WagesCents: 0,
    spouseW2WithheldCents: 0,
    spouseW2SsWagesCents: 0,
    entityType: "self_employed_1099",
    ytdIncomeCents: 0,
    ytdBusinessExpensesCents: 0,
    ytdMealsCents: 0,
    ytdAboveTheLineCents: 0,
    ytdItemizedCents: 0,
    autoMileageCents: 0,
    autoHomeOfficeCents: 0,
    // 12 months entered = the amounts ARE the full-year figures, so the
    // engine's annualization is a no-op and projected == entered.
    monthsEntered: 12,
  };
}

export function toCents(dollars: number): number {
  return Math.round((Number.isFinite(dollars) ? dollars : 0) * 100);
}

/** Filing-status options for the calculator selects. */
export const FILING_STATUS_OPTIONS: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married filing jointly" },
  { value: "married_filing_separately", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_widow", label: "Qualifying surviving spouse" },
];

/** 50 states + DC. "" = skip (federal only). The engine returns ~0 for
 *  the no-income-tax states, so they're correct without special-casing. */
export const US_STATES: { code: string; name: string }[] = [
  { code: "", name: "Skip state (federal only)" },
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];
