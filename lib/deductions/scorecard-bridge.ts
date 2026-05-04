// Maps a scorecard category code (the 24 Schedule C buckets used by
// monthly_expenses + DeductionScorecard) to a slice of the 1025-item
// master IRS deductions catalog. Powers the "click a tile to see the
// items in this category" expansion on the deduction scorecard.

import { MASTER_DEDUCTIONS } from "./master";
import type { MasterDeduction } from "./types";

type Bridge = {
  /** Exact match against MasterDeduction.category. */
  category: string;
  /** Only include items whose name matches this regex (when present). */
  include?: RegExp;
  /** Drop items whose name matches this regex (when present). */
  exclude?: RegExp;
};

// Hand-mapped - the scorecard codes are coarse Schedule C lines while
// the master categories are organized by activity / industry, so a 1:1
// is mostly true with a couple of split rows (travel + meals share one
// master category; office + supplies overlap; etc.).
const SCORECARD_TO_MASTER: Record<string, Bridge> = {
  advertising: { category: "Marketing, advertising, sales, and branding" },
  office: {
    category: "Office, admin, supplies, and operations",
    exclude: /\b(supply|supplies)\b/i,
  },
  supplies: {
    category: "Office, admin, supplies, and operations",
    include: /\b(supply|supplies|raw|material|consumable)\b/i,
  },
  software: { category: "Website, software, SaaS, apps, and digital tools" },
  legal_pro: {
    category: "Legal, accounting, professional services, and compliance",
  },
  insurance: { category: "Insurance and risk management" },
  bank_fees: {
    category: "Financing, banking, and payment costs",
    include: /\b(fee|charge|merchant|processing|wire|ach|gateway)\b/i,
  },
  interest_business: {
    category: "Financing, banking, and payment costs",
    include: /\b(interest|loan|line of credit|financ|credit card interest)\b/i,
  },
  education: {
    category: "Training, education, professional development, and research",
  },
  travel: {
    category: "Travel, meals, gifts, and transportation",
    exclude: /\b(meal|food|coffee|client lunch|gift)\b/i,
  },
  meals: {
    category: "Travel, meals, gifts, and transportation",
    include: /\b(meal|food|coffee|lunch|dinner|breakfast)\b/i,
  },
  wages: {
    category: "Employees, payroll, HR, and benefits",
    include: /\b(wage|salary|payroll|w-?2|bonus)\b/i,
  },
  benefits: {
    category: "Employees, payroll, HR, and benefits",
    include: /\b(health|dental|vision|insurance|401|retirement|benefit|fringe|hsa|fsa|life insurance)\b/i,
  },
  contract_labor: {
    category: "Employees, payroll, HR, and benefits",
    include: /\b(1099|contractor|freelance|contract labor|gig)\b/i,
  },
  car_truck: {
    category: "Transportation, fleet, logistics, and delivery",
  },
  home_office: { category: "Home office and home-based business" },
  utilities: {
    category: "Office, admin, supplies, and operations",
    include: /\b(internet|phone|electric|gas|water|utility|utilities|wifi|cell)\b/i,
  },
  rent_property: {
    category: "Real estate, rentals, and property businesses",
    include: /\b(rent|lease|coworking|office space|warehouse|studio)\b/i,
  },
  rent_equipment: {
    category: "Equipment, assets, depreciation, and Section 179",
    include: /\b(rent|lease)\b/i,
  },
  depreciation: {
    category: "Equipment, assets, depreciation, and Section 179",
    exclude: /\b(rent|lease)\b/i,
  },
  repairs: { category: "Repairs, maintenance, facilities, and property" },
  taxes_licenses: {
    category: "Taxes, licenses, permits, and government fees",
  },
  self_employed_health: {
    category: "Self-employed owner deductions",
    include: /\b(health|insurance|premium|medical)\b/i,
  },
  retirement_self: {
    category: "Self-employed owner deductions",
    include: /\b(sep|solo|simple|401|retirement|ira|pension)\b/i,
  },
  other_business: { category: "Commonly overlooked deductions" },
};

/**
 * Returns master deductions matching the given scorecard code, or an
 * empty array if no bridge is defined.
 */
export function getMasterItemsForScorecardCode(
  code: string,
): MasterDeduction[] {
  const bridge = SCORECARD_TO_MASTER[code];
  if (!bridge) return [];
  return MASTER_DEDUCTIONS.filter((d) => {
    if (d.category !== bridge.category) return false;
    if (bridge.include && !bridge.include.test(d.name)) return false;
    if (bridge.exclude && bridge.exclude.test(d.name)) return false;
    return true;
  });
}

/** Master category name a scorecard tile maps to (for the explorer link). */
export function getMasterCategoryForScorecardCode(
  code: string,
): string | null {
  return SCORECARD_TO_MASTER[code]?.category ?? null;
}
