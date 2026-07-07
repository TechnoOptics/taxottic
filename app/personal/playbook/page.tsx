import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { SavingsGoalCard } from "@/components/SavingsGoalCard";
import { requireUserWithAdmin } from "@/lib/auth";
import { forecast, formatCents, type ForecastResult } from "@/lib/tax/forecast";
import { buildPersonalForecastInput } from "@/lib/tax/personal-forecast-input";
import {
  buildSavingsGoals,
  totalSavingsAcrossGoals,
  type GoalCategory,
  type SavingsGoal,
} from "@/lib/tax/savings-goals";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import { adoptPersonalSavingsGoal } from "./actions";

/**
 * PERSONAL tax-savings playbook — the individual-filer counterpart to
 * the company playbook at /c/[publicId]/savings-goals. Same vetted,
 * IRS-cited engine (buildSavingsGoals), fed ONLY personal inputs:
 * household W-2 wages, the user's tax profile, and their tracked
 * personal deductions. Zero business income goes in, so business-only
 * moves (Solo 401(k), SEP-IRA, QBI, defined-benefit) never fire here —
 * what remains is every legitimate individual lever: 401(k) through
 * the employer, IRA/backdoor Roth/spousal IRA, HSA + health/dependent
 * -care FSA, 529 with the state's own deduction rule, tax-loss
 * harvesting, charitable bunching, energy + EV credits, Saver's
 * credit, and withholding safe-harbor compliance. Every goal cites its
 * IRC section / IRS publication.
 */

const CATEGORY_ORDER: GoalCategory[] = [
  "compliance",
  "retirement",
  "health",
  "investment",
  "charitable",
  "education",
  "energy",
];

const CATEGORY_LABEL: Record<GoalCategory, string> = {
  retirement: "Retirement",
  health: "Health & medical",
  education: "Education",
  investment: "Investments",
  charitable: "Charitable giving",
  energy: "Energy & home",
  compliance: "Compliance",
};

const CATEGORY_INTRO: Record<GoalCategory, string> = {
  retirement:
    "Pre-tax retirement contributions reduce AGI dollar-for-dollar at your marginal rate — the most reliable lever an individual filer has.",
  health:
    "HSA + FSA accounts shelter medical spending from income tax (and FICA when run through payroll). The HSA is the only triple-tax-advantaged account in the U.S. code.",
  education:
    "529 plans grow tax-free for education costs; many states add a state-tax deduction or credit on top.",
  investment:
    "Year-end portfolio moves — capture losses, defer gains, bunch deductions across years.",
  charitable:
    "Turn the giving you already do into a bigger deduction: bunching, donor-advised funds, appreciated stock.",
  energy:
    "Federal credits for efficient-home upgrades and EVs — dollar-for-dollar reductions, not deductions.",
  compliance:
    "Stay penalty-free: withholding, safe harbors, and quarterly catch-ups.",
};

export default async function PersonalPlaybookPage() {
  const { admin, user } = await requireUserWithAdmin();
  const taxYear = new Date().getUTCFullYear();

  const { data: taxProfile } = await admin
    .from("tax_profiles")
    .select("*")
    .eq("user_id", user.id)
    .eq("tax_year", taxYear)
    .maybeSingle();
  if (!taxProfile) {
    redirect(`/onboarding/tax-profile?next=/personal/playbook`);
  }

  const { data: personalExpenseRows } = await admin
    .from("personal_expenses")
    .select("category, amount_cents")
    .eq("user_id", user.id)
    .eq("tax_year", taxYear);

  // Same engine + inputs as /personal/forecast so the playbook's
  // dollar impacts agree with the forecast the user just saw.
  const input = buildPersonalForecastInput(
    taxProfile,
    personalExpenseRows ?? [],
    taxYear,
  );
  const result: ForecastResult = forecast(input);

  const n = (key: string): number => {
    const v = (taxProfile as Record<string, unknown>)[key];
    return typeof v === "number" ? v : 0;
  };

  const goals = buildSavingsGoals({
    result,
    filingStatus: taxProfile.filing_status as FilingStatus,
    age: taxProfile.age,
    state: taxProfile.state_code,
    ownerW2WagesCents: n("owner_w2_wages_cents"),
    spouseW2WagesCents: n("spouse_w2_wages_cents"),
    // Individual side: no business income, so business-only goals
    // (Solo 401(k) / SEP / QBI / DB plan) never fire.
    netSeIncomeCents: 0,
    ytdRetirementContributionsCents:
      n("traditional_ira_contribution_cents") +
      n("solo_401k_contribution_cents") +
      n("sep_ira_contribution_cents"),
    ytdHsaContributionsCents: n("hsa_contribution_cents"),
    ytdItemizedCents: n("itemized_total_cents"),
    itemize: taxProfile.itemize === true,
    dependents: taxProfile.dependents ?? 0,
    dependentsUnder17: n("dependents_under_17"),
  });

  // Adopted = personal goals (company_id NULL) for this year, by title.
  const { data: adopted } = await admin
    .from("goals")
    .select("title")
    .eq("user_id", user.id)
    .is("company_id", null)
    .eq("tax_year", taxYear);
  const adoptedTitles = new Set(
    ((adopted ?? []) as Array<{ title: string }>).map((g) => g.title),
  );

  const byCategory = new Map<GoalCategory, SavingsGoal[]>();
  for (const g of goals) {
    const arr = byCategory.get(g.category);
    if (arr) arr.push(g);
    else byCategory.set(g.category, [g]);
  }
  const totalCents = totalSavingsAcrossGoals(goals);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Personal · Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          Your tax-savings playbook
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-2xl leading-relaxed">
          Personalized, legitimate ways to lower this year&apos;s bill —
          built from your household income, filing status, and what
          you&apos;ve already contributed. Every move cites the IRC section
          and IRS publication behind it. Adopt one and it becomes a goal you
          can track.
        </p>

        {goals.length > 0 ? (
          <div className="card mt-6 p-5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-ink-soft">
              {goals.length} move{goals.length === 1 ? "" : "s"} apply to you
              right now
            </span>
            <span className="display text-2xl text-forest-900 tabular-nums">
              up to {formatCents(totalCents)}{" "}
              <span className="text-sm text-ink-muted font-normal">
                in potential savings
              </span>
            </span>
          </div>
        ) : (
          <div className="card mt-6 p-6 text-sm text-ink-soft">
            Nothing actionable right now — that usually means your profile
            is thin. Add income and household details to{" "}
            <Link
              href="/onboarding/tax-profile?next=/personal/playbook"
              className="text-forest-700 underline decoration-dotted"
            >
              your tax profile
            </Link>{" "}
            and the playbook fills in.
          </div>
        )}

        {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((cat) => (
          <section key={cat} className="mt-10">
            <h2 className="display text-xl text-forest-900">
              {CATEGORY_LABEL[cat]}
            </h2>
            <p className="mt-1 text-xs text-ink-muted max-w-2xl leading-relaxed">
              {CATEGORY_INTRO[cat]}
            </p>
            <ul className="mt-4 grid gap-3">
              {(byCategory.get(cat) ?? []).map((g) => (
                <SavingsGoalCard
                  key={g.id}
                  goal={g}
                  companyId={null}
                  taxYear={taxYear}
                  alreadyAdopted={adoptedTitles.has(g.title)}
                  adoptAction={adoptPersonalSavingsGoal}
                />
              ))}
            </ul>
          </section>
        ))}

        <p className="mt-10 text-[11px] text-ink-muted leading-relaxed max-w-2xl">
          Taxottic produces estimates and educational suggestions, not tax
          advice or a filed return. Confirm binding decisions with your
          CPA — every card above links the IRS source so that conversation
          is short.
        </p>
      </section>
    </main>
  );
}
