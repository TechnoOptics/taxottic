/**
 * Eligible-deduction matrix.
 *
 * Given a business profile (entity type + flags), this returns the list of
 * deduction categories the user *can* legally claim, plus the rationale
 * for each. The user's progress against the list is computed by checking
 * how many they've captured at least once this year (any expense in that
 * category counts).
 *
 * Goal: every business sees a personalized list of ~10-25 deductions that
 * actually apply to them. Crossing items off feels like progress.
 */

import type { EntityType } from "@/lib/tax/forecast";

export type EligibilityContext = {
  entityType: EntityType;
  hasEmployees: boolean;
  hasVehicle: boolean;
  hasHomeOffice: boolean;
};

export type EligibleDeduction = {
  code: string;            // matches public.deduction_categories.code
  weight: number;          // relative importance toward the score (1-5)
  reason: string;          // why it applies for this business
};

const SE_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  "sole_prop",
  "single_llc",
  "self_employed_1099",
  "multi_llc",
  "partnership",
]);

export function eligibleDeductions(ctx: EligibilityContext): EligibleDeduction[] {
  const out: EligibleDeduction[] = [];
  const isSE = SE_ENTITY_TYPES.has(ctx.entityType);
  const isPassThrough = isSE || ctx.entityType === "s_corp";

  // Universal business deductions everyone can take.
  out.push(
    {
      code: "advertising",
      weight: 3,
      reason: "Marketing, ads, and website hosting are ordinary business expenses.",
    },
    {
      code: "office",
      weight: 3,
      reason: "Office supplies, software, postage, small consumables.",
    },
    {
      code: "software",
      weight: 4,
      reason: "SaaS tools, design software, accounting platforms - capture every subscription.",
    },
    {
      code: "supplies",
      weight: 3,
      reason: "Items consumed in providing services or making products.",
    },
    {
      code: "legal_pro",
      weight: 4,
      reason: "Lawyers, accountants, tax preparers, and consultants are deductible.",
    },
    {
      code: "insurance",
      weight: 3,
      reason: "Liability and business-property insurance premiums.",
    },
    {
      code: "bank_fees",
      weight: 2,
      reason: "Business bank service charges and merchant processing fees.",
    },
    {
      code: "education",
      weight: 2,
      reason: "Continuing education that maintains or improves business skills.",
    },
    {
      code: "travel",
      weight: 3,
      reason: "Business trips: flights, hotels, ground transportation when away from your tax home.",
    },
    {
      code: "meals",
      weight: 3,
      reason: "Business meals with clients or while traveling are 50% deductible.",
    },
  );

  // Conditional based on profile flags.
  if (ctx.hasEmployees) {
    out.push(
      {
        code: "wages",
        weight: 5,
        reason: "W-2 wages paid to employees.",
      },
      {
        code: "benefits",
        weight: 4,
        reason: "Health, life, and other employee benefit programs.",
      },
      {
        code: "contract_labor",
        weight: 3,
        reason: "Payments to 1099 contractors. File a 1099-NEC at year end.",
      },
    );
  } else {
    out.push({
      code: "contract_labor",
      weight: 3,
      reason: "Even without employees, payments to freelancers count as contract labor.",
    });
  }

  if (ctx.hasVehicle) {
    out.push({
      code: "car_truck",
      weight: 5,
      reason: "Business use of your vehicle - track miles or actual expenses.",
    });
  }

  if (ctx.hasHomeOffice) {
    out.push({
      code: "home_office",
      weight: 5,
      reason: "A regularly and exclusively used workspace at home is deductible.",
    });
    out.push({
      code: "utilities",
      weight: 3,
      reason: "A portion of internet, phone, electric, and gas at the home office.",
    });
  } else {
    out.push({
      code: "utilities",
      weight: 2,
      reason: "Utilities at any rented business location.",
    });
  }

  // Property + equipment + depreciation
  out.push(
    {
      code: "rent_property",
      weight: 3,
      reason: "Rent for an office, studio, warehouse, or coworking space.",
    },
    {
      code: "rent_equipment",
      weight: 2,
      reason: "Equipment, machinery, or vehicle leases for business use.",
    },
    {
      code: "depreciation",
      weight: 3,
      reason: "Long-lived business assets, written off over time or via §179.",
    },
    {
      code: "repairs",
      weight: 2,
      reason: "Keeping business property in working order.",
    },
  );

  // Taxes + licenses
  out.push({
    code: "taxes_licenses",
    weight: 2,
    reason: "State business taxes, business licenses, and sales tax paid to authorities.",
  });

  // Self-employed-only above-the-line deductions
  if (isSE) {
    out.push(
      {
        code: "self_employed_health",
        weight: 5,
        reason: "Self-employed health insurance premiums for you and your family - above-the-line.",
      },
      {
        code: "retirement_self",
        weight: 5,
        reason: "SEP IRA, Solo 401(k), or SIMPLE IRA contributions - the largest tax-saving lever for SE income.",
      },
    );
  }

  // Pass-throughs get the QBI deduction reminder via a synthetic code
  if (isPassThrough) {
    out.push({
      code: "interest_business",
      weight: 2,
      reason: "Interest on business credit cards or loans.",
    });
  } else {
    out.push({
      code: "interest_business",
      weight: 2,
      reason: "Interest on business loans is deductible at the entity level.",
    });
  }

  // Always-on catch-all
  out.push({
    code: "other_business",
    weight: 1,
    reason: "Anything ordinary and necessary that does not fit elsewhere.",
  });

  // Dedupe by code (in case branches added the same code twice).
  const seen = new Set<string>();
  return out.filter((e) => {
    if (seen.has(e.code)) return false;
    seen.add(e.code);
    return true;
  });
}

export type ScorecardItem = EligibleDeduction & {
  captured: boolean;
  capturedCents: number;
  label: string;
  description: string;
  scheduleC: string | null;
  irsPub: string | null;
};

export type Scorecard = {
  items: ScorecardItem[];
  capturedCount: number;
  totalCount: number;
  capturedWeight: number;
  totalWeight: number;
  scorePct: number;
  milestone: "starter" | "explorer" | "captain" | "maestro" | "legend";
  nextMilestone: { label: string; pct: number } | null;
};

export const MILESTONES = [
  { key: "starter", label: "Starter", pct: 0 },
  { key: "explorer", label: "Explorer", pct: 25 },
  { key: "captain", label: "Captain", pct: 50 },
  { key: "maestro", label: "Maestro", pct: 75 },
  { key: "legend", label: "Legend", pct: 90 },
] as const;

export function buildScorecard(args: {
  eligible: EligibleDeduction[];
  capturedByCode: Map<string, number>; // category_code -> total amount_cents
  categoryMeta: Map<
    string,
    {
      label: string;
      description: string;
      schedule_c_line: string | null;
      irs_pub: string | null;
    }
  >;
}): Scorecard {
  const items: ScorecardItem[] = args.eligible.map((e) => {
    const meta = args.categoryMeta.get(e.code);
    const captured = (args.capturedByCode.get(e.code) ?? 0) > 0;
    return {
      ...e,
      captured,
      capturedCents: args.capturedByCode.get(e.code) ?? 0,
      label: meta?.label ?? e.code,
      description: meta?.description ?? "",
      scheduleC: meta?.schedule_c_line ?? null,
      irsPub: meta?.irs_pub ?? null,
    };
  });

  const totalCount = items.length;
  const capturedCount = items.filter((i) => i.captured).length;
  const totalWeight = items.reduce((a, i) => a + i.weight, 0);
  const capturedWeight = items
    .filter((i) => i.captured)
    .reduce((a, i) => a + i.weight, 0);
  const scorePct =
    totalWeight > 0 ? Math.round((capturedWeight / totalWeight) * 100) : 0;

  let milestone: Scorecard["milestone"] = "starter";
  for (const m of MILESTONES) if (scorePct >= m.pct) milestone = m.key;
  const next = MILESTONES.find((m) => m.pct > scorePct) ?? null;
  const nextMilestone = next
    ? { label: next.label, pct: next.pct }
    : null;

  return {
    items,
    capturedCount,
    totalCount,
    capturedWeight,
    totalWeight,
    scorePct,
    milestone,
    nextMilestone,
  };
}
