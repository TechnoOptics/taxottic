// Maps a free-text "Business type applicability" string from the master
// deductions checklist to a yes/no for a given company entity type.
//
// The source file uses descriptive sentences (e.g. "All entity types in
// food, hospitality, or retail") rather than enums, so this is intentionally
// pattern-matched. Anything we can't confidently exclude defaults to
// "applies" - a deduction that doesn't really fit is much less harmful
// than one we wrongly hide.

import type { CompanyEntityType, MasterDeduction } from "./types";

type Context = {
  entityType: CompanyEntityType | null;
  /** Optional industry tags from the company profile, lowercased. */
  industryTags?: string[];
};

const ENTITY_FRIENDLY: Record<CompanyEntityType, string[]> = {
  sole_prop: ["sole proprietor", "sole prop", "schedule c", "self-employed"],
  single_llc: ["llc", "single-member"],
  multi_llc: ["llc", "multi-member", "partnership"],
  s_corp: ["s corp", "s-corp", "s corporation"],
  c_corp: ["c corp", "c-corp", "corporation"],
  partnership: ["partnership"],
  self_employed_1099: ["self-employed", "sole prop", "1099", "schedule c"],
  nonprofit: ["nonprofit", "nonprofit corporation"],
  cooperative: ["cooperative", "co-op"],
};

const INDUSTRY_GATES: { match: RegExp; needs: RegExp }[] = [
  // Inventory / product / ecommerce specific.
  {
    match: /sell products|hold inventory|ecommerce|product business/i,
    needs: /retail|ecommerce|product|inventory|wholesale|reseller/i,
  },
  // Hospitality / food / retail.
  {
    match: /food, hospitality, or retail|restaurants|hospitality/i,
    needs: /restaurant|food|hospitality|cafe|bar|hotel|retail/i,
  },
  // Construction / trades.
  {
    match: /construction\/trades|construction, trades/i,
    needs: /construction|trade|contractor|electrician|plumber|hvac|carpenter|roof/i,
  },
  // Real estate / rental.
  {
    match: /rental or real estate/i,
    needs: /real estate|rental|property|landlord/i,
  },
  // Creator / media.
  {
    match: /creator\/media|influencer|podcast/i,
    needs: /creator|influencer|podcast|youtube|streamer|media/i,
  },
  // Regulated / wellness / pet.
  {
    match: /regulated product, health, wellness, or pet/i,
    needs: /health|wellness|pet|supplement|cbd|cannabis|food|skincare/i,
  },
  // Delivery / fleet / trucking.
  {
    match: /delivery, trucking, or fleet/i,
    needs: /delivery|fleet|trucking|courier|logistics|driver/i,
  },
  // Farming / agriculture.
  {
    match: /farming, landscaping, nursery, animal/i,
    needs: /farm|landscap|nursery|agriculture|animal|ranch/i,
  },
  // Legal / advocacy.
  {
    match: /legal\/advocacy|professional case work/i,
    needs: /legal|law|attorney|advocacy|paralegal/i,
  },
];

const HAS_EMPLOYEES_RE =
  /with employees or contractors|employees, payroll|w-2|payroll/i;

/**
 * Returns true when this deduction plausibly applies to a company with the
 * given entity type and industry tags. Used by the deductions explorer to
 * filter the catalog.
 */
export function appliesToCompany(
  d: MasterDeduction,
  ctx: Context,
): boolean {
  const a = d.applicability;
  // Universal: applies to everyone.
  if (/^all\b/i.test(a) && !/with employees|sell products|hold inventory|in /i.test(a)) {
    return true;
  }
  // Entity-type-specific list (e.g. "Sole Proprietorship; LLC taxed as ...").
  if (ctx.entityType) {
    const aliases = ENTITY_FRIENDLY[ctx.entityType] ?? [];
    if (aliases.some((al) => a.toLowerCase().includes(al))) return true;
  }
  // Industry-gated rows: only show when the company tags suggest a fit.
  for (const gate of INDUSTRY_GATES) {
    if (gate.match.test(a)) {
      const tags = ctx.industryTags ?? [];
      const hay = tags.join(" ").toLowerCase();
      if (gate.needs.test(hay)) return true;
      // No matching tag and no hint to the contrary - treat as not applicable.
      return false;
    }
  }
  // "All with employees or contractors" - only show if the company has
  // employees. Without employee data we still surface it; payroll
  // categories are useful aspirational reading.
  if (HAS_EMPLOYEES_RE.test(a)) return true;
  // Catch-all: surface it. Better to show a borderline deduction than to
  // silently hide one the user could legitimately claim.
  return true;
}

/** Group an array of master deductions by category, preserving array order. */
export function groupByCategory(
  ds: readonly MasterDeduction[],
): { category: string; items: MasterDeduction[] }[] {
  const map = new Map<string, MasterDeduction[]>();
  for (const d of ds) {
    const arr = map.get(d.category);
    if (arr) arr.push(d);
    else map.set(d.category, [d]);
  }
  return Array.from(map, ([category, items]) => ({ category, items }));
}

/** Case-insensitive search across name, notes, and category. */
export function searchDeductions(
  ds: readonly MasterDeduction[],
  query: string,
): MasterDeduction[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...ds];
  return ds.filter((d) => {
    return (
      d.name.toLowerCase().includes(q) ||
      d.notes.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q) ||
      d.industry.toLowerCase().includes(q)
    );
  });
}
