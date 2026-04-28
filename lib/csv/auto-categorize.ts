/**
 * Keyword-based auto-categorizer. Maps a transaction description to a
 * deduction category code from our taxonomy. First match wins. Returns null
 * if nothing matches; the user reviews uncategorized rows manually.
 *
 * Order matters: more specific matchers first.
 */

type Rule = { code: string; needles: string[] };

const RULES: Rule[] = [
  // Vehicle / fuel / rideshare
  { code: "car_truck", needles: ["shell", "chevron", "exxon", "mobil", "bp ", "76 ", "valero", "arco", "speedway", "circle k", "fuel", "gas station"] },
  { code: "travel", needles: ["uber", "lyft", "taxi", "amtrak", "delta air", "united air", "southwest air", "american airlines", "alaska air", "jetblue", "spirit air", "frontier air", "marriott", "hilton", "hyatt", "airbnb", "vrbo", "rental car", "hertz", "enterprise", "avis", "budget rent"] },

  // Food
  { code: "meals", needles: ["restaurant", "cafe", "coffee", "starbucks", "doordash", "uber eats", "grubhub", "chipotle", "panera", "subway", "mcdonald", "chick-fil-a", "dunkin"] },

  // Software / subscriptions
  { code: "software", needles: ["adobe", "microsoft", "office365", "google workspace", "google cloud", "zoom", "slack", "notion", "linear", "figma", "github", "vercel", "supabase", "openai", "anthropic", "dropbox", "evernote", "asana", "trello", "monday.com", "calendly", "zapier"] },

  // Office / supplies
  { code: "office", needles: ["staples", "office depot", "officemax", "amazon", "best buy", "target", "walmart"] },

  // Telecom / utilities
  { code: "utilities", needles: ["comcast", "xfinity", "verizon", "at&t", "spectrum", "t-mobile", "sprint", "internet", "electric", "pg&e", "con edison", "duke energy", "dominion energy", "water dept"] },

  // Advertising
  { code: "advertising", needles: ["google ads", "facebook ads", "meta ads", "linkedin ads", "tiktok ads", "yelp", "instagram ads", "twitter ads", "x ads", "youtube ads"] },

  // Professional services
  { code: "legal_pro", needles: ["lawyer", "attorney", "legal services", "accountant", "cpa", "h&r block", "turbotax", "bookkeeper", "consultant", "consulting"] },

  // Insurance
  { code: "insurance", needles: ["state farm", "geico", "progressive", "allstate", "liberty mutual", "the hartford", "aig", "insurance"] },

  // Banking + interest
  { code: "bank_fees", needles: ["service charge", "monthly fee", "atm fee", "wire fee", "stripe fee", "square fee", "paypal fee", "merchant fee"] },
  { code: "interest_business", needles: ["interest charge", "credit card interest", "loan interest"] },

  // Rent
  { code: "rent_property", needles: ["wework", "regus", "industrious", "office rent", "studio rent"] },

  // Repairs
  { code: "repairs", needles: ["repair", "maintenance"] },

  // Education
  { code: "education", needles: ["coursera", "udemy", "linkedin learning", "masterclass", "tuition", "course"] },

  // Contract labor
  { code: "contract_labor", needles: ["upwork", "fiverr", "contractor", "freelance"] },

  // Wages (W-2 payroll)
  { code: "wages", needles: ["adp", "gusto", "paychex", "rippling", "justworks", "payroll"] },
];

export function autoCategorize(description: string): string | null {
  const lower = description.toLowerCase();
  for (const rule of RULES) {
    for (const needle of rule.needles) {
      if (lower.includes(needle)) return rule.code;
    }
  }
  return null;
}
