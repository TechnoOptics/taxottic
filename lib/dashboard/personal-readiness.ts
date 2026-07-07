/**
 * PERSONAL tax-readiness score — the individual-filer counterpart to
 * the company readiness meter (lib/dashboard/readiness.ts). Pure
 * function over the user's own data; zero business inputs, so the
 * personal dashboard never leans on a company.
 *
 * Six checks, weighted to reflect forecast accuracy impact. Each check
 * carries a label + the route that fixes it, so the dashboard can
 * render an actionable checklist instead of a bare number.
 */

export type PersonalReadinessCheck = {
  key: string;
  label: string;
  done: boolean;
  href: string;
  weight: number;
};

export type PersonalReadiness = {
  /** 0-100. */
  score: number;
  checks: PersonalReadinessCheck[];
};

export type PersonalReadinessInput = {
  /** tax_profiles row (loosely typed; nulls fine) or null. */
  profile: Record<string, unknown> | null;
  /** Count of tracked personal deduction expenses this tax year. */
  personalExpenseCount: number;
  /** Count of active personal goals (company_id NULL). */
  personalGoalCount: number;
};

function num(profile: Record<string, unknown> | null, key: string): number {
  const v = profile?.[key];
  return typeof v === "number" ? v : 0;
}

export function computePersonalReadiness(
  input: PersonalReadinessInput,
): PersonalReadiness {
  const p = input.profile;
  const householdWages =
    num(p, "owner_w2_wages_cents") +
    num(p, "spouse_w2_wages_cents") +
    num(p, "spouse_income_cents");
  const withheld =
    num(p, "owner_w2_withheld_cents") +
    num(p, "spouse_w2_withheld_cents") +
    num(p, "estimated_payments_cents");

  const checks: PersonalReadinessCheck[] = [
    {
      key: "profile",
      label: "Tax profile set up (filing status, household)",
      done: p != null,
      href: "/onboarding/tax-profile?next=/dashboard",
      weight: 30,
    },
    {
      key: "income",
      label: "Household income entered",
      done: householdWages > 0,
      href: "/onboarding/tax-profile?next=/dashboard",
      weight: 25,
    },
    {
      key: "withholding",
      label: "Withholding / estimated payments entered",
      done: withheld > 0,
      href: "/onboarding/tax-profile?next=/dashboard",
      weight: 20,
    },
    {
      key: "deductions",
      label: "Tracking personal deductions",
      done: input.personalExpenseCount > 0,
      href: "/personal/expenses",
      weight: 15,
    },
    {
      key: "playbook",
      label: "Adopted a savings-playbook move",
      done: input.personalGoalCount > 0,
      href: "/personal/playbook",
      weight: 10,
    },
  ];

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const earned = checks.reduce((a, c) => a + (c.done ? c.weight : 0), 0);
  return { score: Math.round((earned / total) * 100), checks };
}
