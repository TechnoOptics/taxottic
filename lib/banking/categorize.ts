/**
 * Merchant-pattern -> deduction-code auto-categorizer.
 *
 * Pure function. Given a transaction's merchant name + description
 * (whatever the bank feed gives us), return our best guess at the
 * IRS-aligned deduction category, plus a confidence score and an
 * optional recurrence hint when the merchant is an obvious
 * subscription.
 *
 * Mental model:
 *   - Rules are ordered most-specific to most-general. The first
 *     match wins; we don't combine matches.
 *   - Confidence is 0..1. UI uses it to decide whether to auto-apply
 *     (>= 0.85), pre-fill the dropdown (>= 0.6), or leave to the user.
 *   - Patterns are case-insensitive whole-word with reasonable
 *     anchors so "STRIPE FEES" and "stripe.com" both match the
 *     bank-fees rule.
 *
 * The rule list intentionally focuses on the heaviest 1099 / Schedule
 * C use cases (software, meals, travel, vehicle, utilities,
 * advertising, professional fees). It is NOT exhaustive; the user
 * always has the override.
 */

import type { Recurrence } from "@/lib/tax/recurrence";

type Rule = {
  /** Human-readable rule name; used for telemetry + the "rule_name"
   *  column on transaction_category_suggestions so we can audit which
   *  rules are firing in prod. */
  name: string;
  /** Case-insensitive regex run against the lowercased combined haystack. */
  pattern: RegExp;
  /** deduction_categories.code */
  code: string;
  confidence: number;
  recurrence?: Recurrence;
};

export type CategorySuggestion = {
  code: string | null;
  confidence: number;
  recurrence?: Recurrence;
  rule?: string;
};

const RULES: Rule[] = [
  // -------- Sales-tax remittance (treat as a wash, NOT a deduction) --
  // We deliberately DO NOT auto-categorize sales-tax remittances as
  // a Schedule-C expense. They're a liability that was already
  // collected from customers. UI flags these for the sales-tax page.
  {
    name: "sales_tax_remittance",
    pattern: /\b(state.*sales.*tax|sales tax (remit|payment|paid|return)|department of (revenue|taxation)|state comptroller|cdtfa|ftb)\b/i,
    code: "taxes_licenses",
    confidence: 0.55, // intentionally lower so the UI nudges review
  },

  // -------- SaaS / software subscriptions ---------------------------
  {
    name: "saas_dev_tools",
    pattern: /\b(github|gitlab|bitbucket|vercel|netlify|cloudflare|aws|amazon web services|google cloud|gcp|azure|digitalocean|linode|heroku|render\.com|fly\.io|supabase|railway|sentry|datadog|new relic|honeycomb|raygun)\b/i,
    code: "software",
    confidence: 0.95,
    recurrence: "monthly",
  },
  {
    name: "saas_productivity",
    pattern: /\b(notion|linear|asana|monday\.com|airtable|figma|sketch|adobe|microsoft 365|office 365|google workspace|slack|loom|zoom|miro|gong|salesforce|hubspot|pipedrive|intercom|crisp|zendesk|freshworks|zapier|make\.com|n8n|dropbox|box\.com|onedrive|1password|lastpass|bitwarden|dashlane)\b/i,
    code: "software",
    confidence: 0.92,
    recurrence: "monthly",
  },

  // -------- Advertising ---------------------------------------------
  {
    name: "ad_platforms",
    pattern: /\b(google ads|meta ads|facebook ads|instagram ads|linkedin ads|tiktok ads|twitter ads|x ads|reddit ads|pinterest ads|yelp ads|capterra|g2|trustpilot|adwords|adsense|microsoft advertising|bing ads)\b/i,
    code: "advertising",
    confidence: 0.95,
    recurrence: "monthly",
  },

  // -------- Travel --------------------------------------------------
  {
    name: "airlines",
    pattern: /\b(united airlines|delta air|american airlines|southwest air|jetblue|alaska air|spirit airlines|frontier airlines|hawaiian airlines|sun country|allegiant|breeze airways|aer lingus|british airways|air france|klm|lufthansa|virgin atlantic|qatar|emirates|etihad|singapore air|cathay|qantas|ana|jal)\b/i,
    code: "travel",
    confidence: 0.95,
  },
  {
    name: "lodging",
    pattern: /\b(marriott|hilton|hyatt|ihg|holiday inn|wyndham|choice hotels|best western|four seasons|ritz-carlton|airbnb|vrbo|booking\.com|expedia|hotels\.com|kayak|priceline|trip\.com|hotwire)\b/i,
    code: "travel",
    confidence: 0.92,
  },
  {
    name: "ground_transport_business",
    pattern: /\b(hertz|enterprise rent|avis|budget rent|sixt|alamo|national rent|amtrak|via rail|eurostar|tgv)\b/i,
    code: "travel",
    confidence: 0.9,
  },

  // -------- Meals ---------------------------------------------------
  {
    name: "food_delivery",
    pattern: /\b(doordash|uber eats|grubhub|seamless|caviar|postmates|deliveroo|instacart business)\b/i,
    code: "meals",
    confidence: 0.85,
  },
  {
    name: "restaurant_chains",
    pattern: /\b(starbucks|dunkin|chipotle|panera|chick-fil-a|sweetgreen|cava|five guys|shake shack|in-n-out|dominos|pizza hut|taco bell|mcdonalds|wendys|burger king|subway|jersey mike|kfc)\b/i,
    code: "meals",
    confidence: 0.78,
  },
  {
    name: "restaurant_keywords",
    pattern: /\b(restaurant|cafe|coffee|bar & grill|pizzeria|bistro|brewery|tap house|kitchen)\b/i,
    code: "meals",
    confidence: 0.7,
  },

  // -------- Vehicle / fuel -----------------------------------------
  {
    name: "fuel",
    pattern: /\b(shell oil|chevron|exxon|mobil|76 station|arco|bp gas|valero|costco gas|circle k|7-eleven|wawa|sheetz|qt|race ?trac|sunoco|phillips 66|conoco|marathon)\b/i,
    code: "car_truck",
    confidence: 0.88,
  },
  {
    name: "vehicle_service",
    pattern: /\b(jiffy lube|valvoline|firestone|midas|aamco|pep boys|discount tire|les schwab|big o tires|tire rack|autozone|napa auto|advance auto|o'?reilly auto)\b/i,
    code: "car_truck",
    confidence: 0.88,
  },
  {
    name: "rideshare",
    pattern: /\b(uber|lyft|via)\b(?!.*eats)/i,
    code: "travel",
    confidence: 0.7, // ambiguous - could be personal; let user confirm
  },

  // -------- Utilities -----------------------------------------------
  {
    name: "telecom",
    pattern: /\b(comcast|xfinity|spectrum|cox communications|verizon|at&t|t-mobile|sprint|google fiber|google fi|frontier comm|optimum|altice|consolidated)\b/i,
    code: "utilities",
    confidence: 0.85,
    recurrence: "monthly",
  },
  {
    name: "energy_water",
    pattern: /\b(pg&e|pacific gas|southern california edison|consolidated edison|con ?ed|eversource|nyseg|duke energy|dominion energy|xcel energy|tva|water department|water utility)\b/i,
    code: "utilities",
    confidence: 0.88,
    recurrence: "monthly",
  },

  // -------- Insurance -----------------------------------------------
  {
    name: "business_insurance",
    pattern: /\b(hiscox|next insurance|thimble|biberk|simply business|chubb|travelers business|progressive commercial|geico business|state farm.*business)\b/i,
    code: "insurance",
    confidence: 0.9,
    recurrence: "monthly",
  },
  {
    name: "health_insurance",
    pattern: /\b(blue cross|blue shield|aetna|cigna|united healthcare|kaiser permanente|humana|anthem|oscar health)\b/i,
    code: "self_employed_health",
    confidence: 0.85,
    recurrence: "monthly",
  },

  // -------- Bank / payment-processor fees ---------------------------
  {
    name: "merchant_processor_fees",
    pattern: /\b(stripe (fee|payout)|paypal fee|square (fee|cash app)|venmo fee|braintree|adyen|authorize\.net)\b/i,
    code: "bank_fees",
    confidence: 0.9,
  },
  {
    name: "bank_service_charge",
    pattern: /\b(monthly service|service charge|maintenance fee|wire fee|ach fee|atm fee|overdraft fee|insufficient funds|nsf fee)\b/i,
    code: "bank_fees",
    confidence: 0.95,
  },

  // -------- Legal / professional ------------------------------------
  {
    name: "legal_pro",
    pattern: /\b(law (firm|office|group)|legal services|attorney|accountant|cpa firm|h&r block|turbotax|intuit professional|legalzoom|rocket lawyer|incfile|stripe atlas)\b/i,
    code: "legal_pro",
    confidence: 0.88,
  },

  // -------- Coworking / office rent --------------------------------
  {
    name: "coworking",
    pattern: /\b(wework|regus|industrious|knotel|spaces by regus|deskpass|the wing|impact hub|switchyards|venture x)\b/i,
    code: "rent_property",
    confidence: 0.95,
    recurrence: "monthly",
  },

  // -------- Office supplies ----------------------------------------
  {
    name: "office_supplies",
    pattern: /\b(staples|office depot|officemax|quill\.com|paper culture|moo print|vistaprint|costco business|sam's club business|amazon business)\b/i,
    code: "office",
    confidence: 0.78,
  },

  // -------- Education / courses -------------------------------------
  {
    name: "education",
    pattern: /\b(udemy|coursera|edx|pluralsight|linkedin learning|masterclass|skillshare|domestika|frontend masters|egghead|cbt nuggets)\b/i,
    code: "education",
    confidence: 0.88,
  },

  // -------- Contract labor / freelance platforms -------------------
  {
    name: "contract_labor",
    pattern: /\b(upwork|fiverr|toptal|gigster|99designs|catalant|braintrust|deel|gusto contractor|justworks contractor)\b/i,
    code: "contract_labor",
    confidence: 0.85,
  },
];

export function suggestCategory(args: {
  merchant?: string | null;
  description?: string | null;
  amountCents?: number;
}): CategorySuggestion {
  const { merchant, description, amountCents } = args;
  const haystack = `${merchant ?? ""} ${description ?? ""}`.toLowerCase();
  if (!haystack.trim()) return { code: null, confidence: 0 };

  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) {
      // Income-side check: if amount is negative (money in) on most
      // bank feeds, this isn't an expense at all - skip the rule and
      // let the user mark it as income manually for now.
      if (typeof amountCents === "number" && amountCents < 0) {
        return { code: null, confidence: 0 };
      }
      return {
        code: rule.code,
        confidence: rule.confidence,
        recurrence: rule.recurrence,
        rule: rule.name,
      };
    }
  }

  return { code: null, confidence: 0 };
}

/**
 * Confidence threshold above which the UI should pre-apply the
 * suggestion without forcing the user to click. Below this, we still
 * show the guess but require a confirm.
 */
export const AUTO_APPLY_CONFIDENCE = 0.88;

/**
 * Threshold below which we don't bother showing a guess at all.
 */
export const SHOW_SUGGESTION_CONFIDENCE = 0.55;
