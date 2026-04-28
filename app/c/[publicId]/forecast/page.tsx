import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { DeductionScorecard } from "@/components/DeductionScorecard";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import {
  forecast,
  formatCents,
  type EntityType,
  type ForecastInput,
} from "@/lib/tax/forecast";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import {
  buildScorecard,
  eligibleDeductions,
} from "@/lib/deductions/eligibility";

type Params = Promise<{ publicId: string }>;

export default async function ForecastPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

  const taxYear = new Date().getUTCFullYear();

  // Pull tax profile, business profile, monthly entries.
  const [
    { data: taxProfile },
    { data: businessProfile },
    { data: incomeRows },
    { data: expenseRows },
  ] = await Promise.all([
    supabase
      .from("tax_profiles")
      .select("*")
      .eq("user_id", user.id)
      .eq("tax_year", taxYear)
      .maybeSingle(),
    supabase
      .from("business_profiles")
      .select("*")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear)
      .maybeSingle(),
    supabase
      .from("monthly_income")
      .select("amount_cents, month")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear),
    supabase
      .from("monthly_expenses")
      .select("amount_cents, month, category_code")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear),
  ]);

  if (!taxProfile) {
    redirect(`/onboarding/tax-profile?next=/c/${publicId}/forecast`);
  }

  // Aggregate
  const ytdIncome = sum(incomeRows ?? [], (r) => r.amount_cents);
  const ytdExpense = sum(expenseRows ?? [], (r) => r.amount_cents);
  const ytdMeals = sum(
    (expenseRows ?? []).filter((r) => r.category_code === "meals"),
    (r) => r.amount_cents,
  );
  const monthsEntered = uniqueMonths(
    [
      ...(incomeRows ?? []).map((r) => r.month),
      ...(expenseRows ?? []).map((r) => r.month),
    ],
  );

  const input: ForecastInput = {
    taxYear,
    filingStatus: taxProfile.filing_status as FilingStatus,
    stateCode: taxProfile.state_code,
    age: taxProfile.age,
    isBlind: taxProfile.is_blind,
    itemize: taxProfile.itemize,
    dependents: taxProfile.dependents,
    spouseIncomeCents: taxProfile.spouse_income_cents ?? 0,
    estimatedPaymentsCents: taxProfile.estimated_payments_cents ?? 0,
    entityType: (company.entity_type ?? "sole_prop") as EntityType,
    ytdIncomeCents: ytdIncome,
    ytdExpenseCents: ytdExpense,
    ytdMealsCents: ytdMeals,
    ytdItemizedCents: 0, // Phase 2.5 - read from personal expenses with personal scope
    monthsEntered: Math.max(1, monthsEntered),
  };

  const result = forecast(input);

  // Per-month income for the chart
  const incomeByMonth = monthBuckets(
    (incomeRows ?? []).map((r) => ({ month: r.month, amount: r.amount_cents })),
  );
  const expenseByMonth = monthBuckets(
    (expenseRows ?? []).map((r) => ({ month: r.month, amount: r.amount_cents })),
  );

  // Deduction scorecard: which eligible deductions has this business captured?
  const eligible = eligibleDeductions({
    entityType: (company.entity_type ?? "sole_prop") as EntityType,
    hasEmployees: businessProfile?.has_employees ?? false,
    hasVehicle: businessProfile?.has_vehicle ?? false,
    hasHomeOffice: businessProfile?.has_home_office ?? false,
  });
  const capturedByCode = new Map<string, number>();
  for (const r of expenseRows ?? []) {
    capturedByCode.set(
      r.category_code,
      (capturedByCode.get(r.category_code) ?? 0) + r.amount_cents,
    );
  }
  const { data: categoryRows } = await supabase
    .from("deduction_categories")
    .select(
      "code, label, description, schedule_c_line, irs_pub, irc_section, pub_chapter, irs_url",
    )
    .in(
      "code",
      eligible.map((e) => e.code),
    );
  const categoryMeta = new Map<
    string,
    {
      label: string;
      description: string;
      schedule_c_line: string | null;
      irs_pub: string | null;
      irc_section: string | null;
      pub_chapter: string | null;
      irs_url: string | null;
    }
  >();
  for (const c of (categoryRows ?? []) as Array<{
    code: string;
    label: string;
    description: string;
    schedule_c_line: string | null;
    irs_pub: string | null;
    irc_section: string | null;
    pub_chapter: string | null;
    irs_url: string | null;
  }>) {
    categoryMeta.set(c.code, {
      label: c.label,
      description: c.description,
      schedule_c_line: c.schedule_c_line,
      irs_pub: c.irs_pub,
      irc_section: c.irc_section,
      pub_chapter: c.pub_chapter,
      irs_url: c.irs_url,
    });
  }
  const scorecard = buildScorecard({ eligible, capturedByCode, categoryMeta });

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              {company.public_id} - Tax year {taxYear}
            </div>
            <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
              {company.name}
            </h1>
          </div>
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="forecast" />
        </div>

        {/* Hero number */}
        <div className="card mt-8 p-7 sm:p-9">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Projected total liability
          </div>
          <div className="display mt-2 text-5xl sm:text-6xl text-forest-900">
            {formatCents(result.totalTaxCents)}
          </div>
          <div className="mt-2 text-sm text-ink-soft">
            Based on {input.monthsEntered} month
            {input.monthsEntered === 1 ? "" : "s"} of entries, projected to
            year-end.
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat
              label="Already paid (estimated)"
              value={formatCents(result.alreadyPaidCents)}
            />
            <Stat
              label="Still owed"
              value={formatCents(result.stillOwedCents)}
              accent
            />
            <Stat
              label="Save per month"
              value={formatCents(result.monthlySaveTargetCents)}
            />
          </div>
        </div>

        {/* Breakdown */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Federal income tax">
            <BigNumber>{formatCents(result.federalIncomeTaxCents)}</BigNumber>
            <RowKV label="Taxable income" value={formatCents(result.taxableIncomeCents)} />
            <RowKV label="Marginal rate" value={pct(result.marginalRate)} />
            <RowKV label="Effective rate" value={pct(result.effectiveRate)} />
          </Card>
          <Card title="Self-employment tax">
            <BigNumber>{formatCents(result.selfEmploymentTaxCents)}</BigNumber>
            <RowKV label="Entity type" value={prettyEntity(input.entityType)} />
            <RowKV
              label="Net business income (proj.)"
              value={formatCents(result.projectedNetBusinessIncomeCents)}
            />
            <RowKV
              label="QBI deduction"
              value={formatCents(result.qbiDeductionCents)}
            />
          </Card>
          <Card title="State">
            <BigNumber>{formatCents(result.stateTaxCents)}</BigNumber>
            <RowKV label="State" value={taxProfile.state_code ?? "Not set"} />
            <RowKV
              label="Method"
              value="Flat-rate estimate"
            />
            <p className="mt-3 text-xs text-ink-muted leading-relaxed">
              State estimate uses a curated flat rate. Real bracketed math for
              all 50 states is on the roadmap.
            </p>
          </Card>
        </div>

        {/* Monthly chart */}
        <div className="mt-6 card p-7">
          <h2 className="display text-xl text-forest-900">Monthly trend</h2>
          <p className="text-xs text-ink-muted mt-1">
            Income and deductible expenses through the year so far.
          </p>
          <MonthlyBars income={incomeByMonth} expenses={expenseByMonth} />
        </div>

        {/* Deduction scorecard */}
        <DeductionScorecard publicId={publicId} scorecard={scorecard} />

        {/* Hints */}
        {result.hints.length > 0 ? (
          <div className="mt-6 card p-6 border-gold-300/60">
            <h2 className="display text-base text-forest-900">Notes from Bella</h2>
            <ul className="mt-3 grid gap-2">
              {result.hints.map((h, i) => (
                <li
                  key={i}
                  className="text-sm text-ink-soft leading-relaxed flex gap-2"
                >
                  <span className="text-gold-700">{"•"}</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Quick actions */}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/c/${publicId}/income`} className="btn-ghost">
            Add income
          </Link>
          <Link href={`/c/${publicId}/expenses`} className="btn-ghost">
            Add expense
          </Link>
          <Link href={`/c/${publicId}/profile`} className="btn-ghost">
            Edit business profile
          </Link>
        </div>

        <p className="mt-12 text-[11px] leading-relaxed text-ink-muted max-w-2xl">
          Taxottic provides tax forecasting and educational guidance. Numbers
          shown are estimates based on the 2025 federal brackets and a curated
          state rate; they are not a tax return. Talk with a licensed CPA for
          decisions that matter.
        </p>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-xl bg-forest-800 text-cream p-4"
          : "rounded-xl bg-white border border-forest-100 p-4"
      }
    >
      <div
        className={
          accent
            ? "text-[11px] uppercase tracking-[0.2em] text-gold-300"
            : "text-[11px] uppercase tracking-[0.2em] text-gold-700"
        }
      >
        {label}
      </div>
      <div
        className={
          accent
            ? "display text-2xl mt-1 text-cream"
            : "display text-2xl mt-1 text-forest-900"
        }
      >
        {value}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6">
      <h2 className="text-xs uppercase tracking-[0.2em] text-gold-700">
        {title}
      </h2>
      {children}
    </div>
  );
}

function BigNumber({ children }: { children: React.ReactNode }) {
  return (
    <div className="display text-3xl text-forest-900 mt-2">{children}</div>
  );
}

function RowKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1.5 border-b last:border-b-0 border-forest-50">
      <span className="text-ink-muted">{label}</span>
      <span className="text-forest-900 font-medium">{value}</span>
    </div>
  );
}

function MonthlyBars({
  income,
  expenses,
}: {
  income: number[];
  expenses: number[];
}) {
  const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const peak = Math.max(...income, ...expenses, 1);
  return (
    <div className="mt-5 grid grid-cols-12 gap-1.5">
      {months.map((m, i) => {
        const inH = (income[i] / peak) * 100;
        const exH = (expenses[i] / peak) * 100;
        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="w-full h-32 flex items-end gap-0.5">
              <div
                className="flex-1 bg-forest-700 rounded-sm"
                style={{ height: `${inH}%` }}
                title={`Income ${formatCents(income[i])}`}
              />
              <div
                className="flex-1 bg-gold-400 rounded-sm"
                style={{ height: `${exH}%` }}
                title={`Expenses ${formatCents(expenses[i])}`}
              />
            </div>
            <span className="text-[10px] text-ink-muted">{m}</span>
          </div>
        );
      })}
      <div className="col-span-12 mt-2 flex gap-4 text-[11px] text-ink-muted justify-end">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 bg-forest-700 rounded-sm" />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 bg-gold-400 rounded-sm" />
          Deductible expenses
        </span>
      </div>
    </div>
  );
}

function sum<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((a, r) => a + (pick(r) || 0), 0);
}

function uniqueMonths(months: number[]): number {
  return new Set(months).size;
}

function monthBuckets(rows: { month: number; amount: number }[]): number[] {
  const buckets = Array(12).fill(0) as number[];
  for (const r of rows) buckets[r.month - 1] += r.amount;
  return buckets;
}

function pct(rate: number): string {
  return (rate * 100).toFixed(1) + "%";
}

function prettyEntity(t: EntityType): string {
  return (
    {
      sole_prop: "Sole Proprietor",
      single_llc: "Single-Member LLC",
      multi_llc: "Multi-Member LLC",
      s_corp: "S-Corp",
      c_corp: "C-Corp",
      partnership: "Partnership",
      self_employed_1099: "1099 / Self-Employed",
    }[t] ?? t
  );
}
