// Best-fit master deduction lookup for a bank transaction. Used by the
// banks page to surface the IRS-aligned deduction name + source URL next
// to each transaction (e.g. "Adobe Creative Cloud" -> M403 "Software /
// subscriptions" instead of just the Schedule C bucket "office").
//
// Strategy:
//   1. Fast merchant keyword table (handwritten, ~40 common patterns).
//      A precise match here is the strongest signal.
//   2. Plaid personal_finance_category -> master category fallback. We
//      pick the first deduction in the matched category; the explorer
//      gives the full picture.
//   3. Final fallback: null. Caller can choose to display nothing or a
//      generic Schedule C label.

import { MASTER_DEDUCTIONS } from "./master";
import type { MasterDeduction } from "./types";

// Plaid `personal_finance_category.primary` -> master category name.
// Pulled directly from the categories present in MASTER_DEDUCTIONS.
const PLAID_TO_MASTER_CATEGORY: Record<string, string | null> = {
  TRAVEL: "Travel, meals, gifts, and transportation",
  TRANSPORTATION: "Transportation, fleet, logistics, and delivery",
  RENT_AND_UTILITIES: "Office, admin, supplies, and operations",
  HOME_IMPROVEMENT: "Repairs, maintenance, facilities, and property",
  FOOD_AND_DRINK: "Travel, meals, gifts, and transportation",
  GENERAL_SERVICES: "Legal, accounting, professional services, and compliance",
  GENERAL_MERCHANDISE: "Office, admin, supplies, and operations",
  ENTERTAINMENT: "Travel, meals, gifts, and transportation",
  BANK_FEES: "Financing, banking, and payment costs",
  GOVERNMENT_AND_NON_PROFIT: "Taxes, licenses, permits, and government fees",
  LOAN_PAYMENTS: "Financing, banking, and payment costs",
  MEDICAL: "Employees, payroll, HR, and benefits",
  PERSONAL_CARE: null,
  TRANSFER_IN: null,
  TRANSFER_OUT: null,
  INCOME: null,
};

// Merchant token -> a substring to find in a master deduction `name`.
// Order matters: the first matching pattern wins, so put more specific
// brands above broader generic words.
const MERCHANT_PATTERNS: { token: RegExp; nameContains: string }[] = [
  // Software / SaaS - most common business spend, so the table starts here.
  { token: /\badobe\b/i, nameContains: "Adobe" },
  { token: /\b(aws|amazon web services)\b/i, nameContains: "AWS" },
  { token: /\b(google\s*cloud|gcp)\b/i, nameContains: "Google" },
  { token: /\b(microsoft|m365|office\s*365|azure)\b/i, nameContains: "Microsoft" },
  { token: /\bgithub\b/i, nameContains: "GitHub" },
  { token: /\b(slack|notion|linear|figma|asana)\b/i, nameContains: "subscription" },
  { token: /\b(zoom|loom|gong)\b/i, nameContains: "Zoom" },
  { token: /\b(canva|dropbox|box\.com)\b/i, nameContains: "subscription" },
  { token: /\b(stripe|square|braintree|paypal)\s+fee/i, nameContains: "Stripe" },
  { token: /\bopenai|anthropic|claude|chatgpt\b/i, nameContains: "AI" },

  // Advertising
  { token: /google\s+ads/i, nameContains: "Google Ads" },
  { token: /\bfacebook\b.*ads|\bmeta\b.*ads/i, nameContains: "Meta" },
  { token: /\binstagram\b.*ads/i, nameContains: "Instagram" },
  { token: /\btiktok\b.*ads/i, nameContains: "TikTok" },
  { token: /\blinkedin\b.*ads/i, nameContains: "LinkedIn" },
  { token: /\bx\.com\b.*ads|twitter.*ads/i, nameContains: "X" },

  // Travel - flights / hotels / rideshare
  { token: /\b(delta|united|american airlines|southwest|jetblue|alaska)\b/i, nameContains: "flight" },
  { token: /\b(marriott|hilton|hyatt|ihg|airbnb|vrbo)\b/i, nameContains: "lodging" },
  { token: /\b(uber|lyft)\b/i, nameContains: "rideshare" },
  { token: /\b(hertz|avis|enterprise|budget)\s*rental/i, nameContains: "rental car" },

  // Food / meals
  { token: /\b(doordash|ubereats|grubhub|sweetgreen|chipotle|starbucks)\b/i, nameContains: "meal" },

  // Telecom / utilities
  { token: /\b(verizon|at&t|t-mobile|sprint)\b/i, nameContains: "phone" },
  { token: /\b(comcast|spectrum|xfinity|cox|fios)\b/i, nameContains: "internet" },

  // Office / supplies
  { token: /\b(amazon\.com|amzn|amazon\s+marketplace)\b/i, nameContains: "office" },
  { token: /\bstaples|office\s*depot|costco\s*business\b/i, nameContains: "supplies" },

  // Vehicles
  { token: /\b(shell|chevron|exxon|bp|mobil)\b/i, nameContains: "fuel" },

  // Professional services
  { token: /\b(legalzoom|clerky|gusto|deel|justworks|adp|paychex)\b/i, nameContains: "payroll" },
  { token: /\bquickbooks|xero|freshbooks|wave\b/i, nameContains: "accounting" },

  // Banking / fees
  { token: /\b(stripe|square)\s*(fee|charge|processing)/i, nameContains: "processing" },
  { token: /\b(wise|payoneer|mercury)\b/i, nameContains: "banking" },
];

/**
 * Look up the best-fit master deduction for a bank transaction.
 *
 * @param merchant The merchant_name or description string from Plaid.
 * @param plaidCategory The personal_finance_category.primary value, if any.
 */
export function findMasterForExpense(
  merchant: string | null,
  plaidCategory: string | null,
): MasterDeduction | null {
  // Step 1: merchant pattern table.
  if (merchant) {
    for (const p of MERCHANT_PATTERNS) {
      if (p.token.test(merchant)) {
        const hit = MASTER_DEDUCTIONS.find((d) =>
          d.name.toLowerCase().includes(p.nameContains.toLowerCase()),
        );
        if (hit) return hit;
      }
    }
  }

  // Step 2: Plaid primary category -> master category.
  if (plaidCategory) {
    const masterCat = PLAID_TO_MASTER_CATEGORY[plaidCategory];
    if (masterCat) {
      const hit = MASTER_DEDUCTIONS.find((d) => d.category === masterCat);
      if (hit) return hit;
    }
  }

  return null;
}
