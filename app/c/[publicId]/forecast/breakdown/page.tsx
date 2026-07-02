import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { CompanyLogo } from "@/components/CompanyLogo";
import { PageHeader } from "@/components/PageHeader";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { formatCents } from "@/lib/tax/forecast";
import {
  buildCompanyForecast,
  type IncomeRow,
  type ExpenseRow,
  type ForecastTaxProfile,
  type ForecastBusinessProfile,
} from "@/lib/tax/company-forecast";

type Params = Promise<{ publicId: string }>;
type SP = Promise<{ view?: string }>;

// Admin-only breakdown of the SAME whole-company forecast (main
// /forecast page) by department and by employee. This deliberately
// does NOT re-run buildCompanyForecast() per slice — federal tax
// brackets are non-linear, so summing N independent per-slice
// forecasts would NOT add back up to the company total, which would
// read as broken math to anyone comparing the two pages. Instead: the
// whole-company forecast is computed once (identical numbers to
// /forecast), and each department/employee gets a plain contribution
// breakdown — income logged, expenses logged, mileage deduction,
// net — plus its % share of the company total. That's the accurate,
// explainable version of "forecasting for each and the business as a
// whole."
export default async function ForecastBreakdownPage({
  params,
}: {
  params: Params;
  searchParams?: SP;
}) {
  const { publicId } = await params;
  const { supabase, user, company, isManager } =
    await loadCompanyByPublicId(publicId);

  if (!isManager) redirect(`/c/${publicId}/forecast`);

  const taxYear = new Date().getUTCFullYear();
  const currentMonth = new Date().getUTCMonth() + 1;

  const [
    { data: taxProfile },
    { data: businessProfile },
    { data: incomeRows },
    { data: expenseRows },
    { data: tripRows },
    { data: memberRows },
    { data: departmentRows },
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
      .select("amount_cents, month, recurrence, user_id")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear),
    supabase
      .from("monthly_expenses")
      .select("amount_cents, month, category_code, recurrence, user_id")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear),
    supabase
      .from("mileage_trips")
      .select("deduction_cents, distance_miles, driver_user_id")
      .eq("company_id", company.id)
      .eq("classification", "business")
      .eq("tax_year", taxYear),
    supabase
      .from("company_members")
      .select("user_id, role, department_id, employee_number, profile:profiles(full_name, email)")
      .eq("company_id", company.id),
    supabase
      .from("departments")
      .select("id, name")
      .eq("company_id", company.id)
      .order("name"),
  ]);

  if (!taxProfile) {
    redirect(`/onboarding/tax-profile?next=/c/${publicId}/forecast/breakdown`);
  }

  const incomes = (incomeRows ?? []) as (IncomeRow & { user_id: string | null })[];
  const expenses = (expenseRows ?? []) as (ExpenseRow & { user_id: string | null })[];
  const trips = (tripRows ?? []) as {
    deduction_cents: number;
    distance_miles: number;
    driver_user_id: string | null;
  }[];
  type MemberRow = {
    user_id: string;
    role: string;
    department_id: string | null;
    employee_number: number | null;
    profile: { full_name: string | null; email: string | null } | null;
  };
  // PostgREST returns the to-one `profile:profiles(...)` embed as an
  // object at runtime, but without generated DB types TS can only infer
  // it loosely — normalize defensively (some client configs return a
  // single-element array instead) rather than fight the cast.
  const members: MemberRow[] = (memberRows ?? []).map((m) => {
    const raw = m as unknown as Omit<MemberRow, "profile"> & {
      profile: MemberRow["profile"] | MemberRow["profile"][];
    };
    return {
      ...raw,
      profile: Array.isArray(raw.profile) ? (raw.profile[0] ?? null) : raw.profile,
    };
  });
  const departments = (departmentRows ?? []) as { id: string; name: string }[];

  // Whole-company forecast — identical inputs/engine call to the main
  // /forecast page, so the "whole business" numbers here always match.
  const trackedYtdMileageCents = trips.reduce(
    (a, t) => a + Number(t.deduction_cents ?? 0),
    0,
  );
  const { result, ytdResult, deductionBreakdown } = buildCompanyForecast({
    taxYear,
    currentMonth,
    company: {
      state_code: company.state_code ?? null,
      entity_type: company.entity_type ?? null,
    },
    taxProfile: taxProfile as unknown as ForecastTaxProfile,
    businessProfile:
      (businessProfile as unknown as ForecastBusinessProfile | null) ?? null,
    incomes,
    expenses,
    trackedYtdMileageCents,
    trackedTripCount: trips.length,
  });

  // Per-employee raw contribution (income / expenses / mileage logged).
  // Deliberately NOT a re-run of the tax engine — see file header.
  type Slice = {
    incomeCents: number;
    expenseCents: number;
    mileageCents: number;
    miles: number;
  };
  const byEmployee = new Map<string, Slice>();
  function bump(userId: string | null, patch: Partial<Slice>) {
    const key = userId ?? "unknown";
    const cur = byEmployee.get(key) ?? {
      incomeCents: 0,
      expenseCents: 0,
      mileageCents: 0,
      miles: 0,
    };
    byEmployee.set(key, {
      incomeCents: cur.incomeCents + (patch.incomeCents ?? 0),
      expenseCents: cur.expenseCents + (patch.expenseCents ?? 0),
      mileageCents: cur.mileageCents + (patch.mileageCents ?? 0),
      miles: cur.miles + (patch.miles ?? 0),
    });
  }
  for (const r of incomes) bump(r.user_id, { incomeCents: r.amount_cents });
  for (const r of expenses) bump(r.user_id, { expenseCents: r.amount_cents });
  for (const t of trips)
    bump(t.driver_user_id, {
      mileageCents: Number(t.deduction_cents ?? 0),
      miles: Number(t.distance_miles ?? 0),
    });

  const memberByUserId = new Map(members.map((m) => [m.user_id, m]));
  const employeeRows = Array.from(byEmployee.entries())
    .map(([userId, slice]) => {
      const member = memberByUserId.get(userId);
      const dept = member?.department_id
        ? departments.find((d) => d.id === member.department_id)
        : null;
      return {
        userId,
        name:
          member?.profile?.full_name ??
          member?.profile?.email ??
          (userId === "unknown" ? "Unattributed" : "Former member"),
        employeeNumber: member?.employee_number ?? null,
        departmentName: dept?.name ?? "Unassigned",
        net: slice.incomeCents - slice.expenseCents - slice.mileageCents,
        ...slice,
      };
    })
    .sort((a, b) => b.incomeCents + b.mileageCents - (a.incomeCents + a.mileageCents));

  const totalIncome = employeeRows.reduce((a, r) => a + r.incomeCents, 0) || 1;
  const totalExpense =
    employeeRows.reduce((a, r) => a + r.expenseCents + r.mileageCents, 0) || 1;

  // Roll employee rows up into department rows (including "Unassigned").
  const byDept = new Map<string, typeof employeeRows>();
  for (const row of employeeRows) {
    const key = row.departmentName;
    const arr = byDept.get(key) ?? [];
    arr.push(row);
    byDept.set(key, arr);
  }
  const departmentSummaries = Array.from(byDept.entries())
    .map(([name, rows]) => ({
      name,
      memberCount: rows.length,
      incomeCents: rows.reduce((a, r) => a + r.incomeCents, 0),
      expenseCents: rows.reduce((a, r) => a + r.expenseCents, 0),
      mileageCents: rows.reduce((a, r) => a + r.mileageCents, 0),
      net: rows.reduce((a, r) => a + r.net, 0),
      rows,
    }))
    .sort((a, b) => b.incomeCents - a.incomeCents);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
        <PageHeader
          logo={
            <CompanyLogo src={company.logo_url} name={company.name} size={64} />
          }
          eyebrow={`Tax year ${taxYear} · Department & employee breakdown`}
          title={company.name}
        />

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="forecast" />
        </div>

        <div className="mt-4">
          <Link
            href={`/c/${publicId}/forecast`}
            className="text-xs text-ink-muted underline decoration-dotted hover:text-forest-900"
          >
            ← Back to the whole-company forecast
          </Link>
        </div>

        {/* Whole-company summary — identical numbers to /forecast, shown
            here as the baseline every slice's % share is measured against. */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat label="YTD income" value={formatCents(ytdResult.projectedIncomeCents)} />
          <MiniStat label="YTD expenses" value={formatCents(ytdResult.projectedExpensesCents)} />
          <MiniStat
            label="Year-end taxes owed"
            value={formatCents(result.totalTaxCents)}
            tone={result.totalTaxCents > 0 ? "warn" : "good"}
          />
          <MiniStat
            label="Deduction sources"
            value={String(deductionBreakdown.length)}
            caption="see /forecast for detail"
          />
        </div>

        <h2 className="display mt-10 text-xl text-forest-900">By department</h2>
        <p className="mt-1 text-xs text-ink-muted max-w-2xl">
          Income and expenses logged by each department&apos;s members, plus
          their tracked business mileage deduction. Percent-of-company
          columns show each department&apos;s share — the fastest way to see
          where spend and revenue are concentrated.
        </p>
        <div className="mt-4 grid gap-3">
          {departmentSummaries.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No income or expenses logged yet.
            </p>
          ) : (
            departmentSummaries.map((d) => (
              <DeptCard
                key={d.name}
                name={d.name}
                memberCount={d.memberCount}
                incomeCents={d.incomeCents}
                expenseCents={d.expenseCents}
                mileageCents={d.mileageCents}
                net={d.net}
                incomeShare={d.incomeCents / totalIncome}
                expenseShare={(d.expenseCents + d.mileageCents) / totalExpense}
              />
            ))
          )}
        </div>

        <h2 className="display mt-10 text-xl text-forest-900">By employee</h2>
        <p className="mt-1 text-xs text-ink-muted max-w-2xl">
          Every teammate who has logged income, an expense, or a business
          drive this tax year, sorted by total contribution.
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-forest-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-cream/60 text-left text-[10px] uppercase tracking-[0.18em] text-gold-700">
                <th className="px-4 py-2.5 font-medium">Employee</th>
                <th className="px-4 py-2.5 font-medium">Department</th>
                <th className="px-4 py-2.5 font-medium text-right">Income</th>
                <th className="px-4 py-2.5 font-medium text-right">Expenses</th>
                <th className="px-4 py-2.5 font-medium text-right">Mileage</th>
                <th className="px-4 py-2.5 font-medium text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-50">
              {employeeRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-muted">
                    No activity logged yet.
                  </td>
                </tr>
              ) : (
                employeeRows.map((r) => (
                  <tr key={r.userId}>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-medium text-forest-900">
                        {r.name}
                      </span>
                      {r.employeeNumber != null ? (
                        <span className="ml-1.5 text-[11px] text-ink-muted">
                          #{r.employeeNumber}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">
                      {r.departmentName}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCents(r.incomeCents)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCents(r.expenseCents)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCents(r.mileageCents)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-forest-900">
                      {formatCents(r.net)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-[11px] text-ink-muted leading-relaxed max-w-2xl">
          This breakdown shows what each department and employee logged — it
          is not a separate tax forecast per slice. Federal tax brackets are
          non-linear, so per-slice forecasts wouldn&apos;t sum back to the
          company total shown above and on the main forecast page.
        </p>
      </section>
    </main>
  );
}

function MiniStat({
  label,
  value,
  caption,
  tone = "neutral",
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "neutral" | "good" | "warn";
}) {
  const dot =
    tone === "good"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-400"
        : "bg-gold-400";
  return (
    <article className="card p-3 flex items-center gap-2.5">
      <span aria-hidden="true" className={"size-2 rounded-full shrink-0 " + dot} />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
          {label}
        </div>
        <div className="display text-lg text-forest-900 tabular-nums mt-0.5 truncate">
          {value}
        </div>
        {caption ? (
          <div className="text-[10px] text-ink-muted mt-0.5">{caption}</div>
        ) : null}
      </div>
    </article>
  );
}

function DeptCard({
  name,
  memberCount,
  incomeCents,
  expenseCents,
  mileageCents,
  net,
  incomeShare,
  expenseShare,
}: {
  name: string;
  memberCount: number;
  incomeCents: number;
  expenseCents: number;
  mileageCents: number;
  net: number;
  incomeShare: number;
  expenseShare: number;
}) {
  return (
    <article className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-lg text-forest-900">{name}</h3>
        <span className="text-[11px] text-ink-muted">
          {memberCount} {memberCount === 1 ? "member" : "members"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
            Income
          </div>
          <div className="tabular-nums text-forest-900 mt-0.5">
            {formatCents(incomeCents)}
          </div>
          <div className="text-[10px] text-ink-muted mt-0.5">
            {Math.round(incomeShare * 100)}% of company
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
            Expenses
          </div>
          <div className="tabular-nums text-forest-900 mt-0.5">
            {formatCents(expenseCents)}
          </div>
          <div className="text-[10px] text-ink-muted mt-0.5">
            {Math.round(expenseShare * 100)}% of company
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
            Mileage deduction
          </div>
          <div className="tabular-nums text-forest-900 mt-0.5">
            {formatCents(mileageCents)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
            Net
          </div>
          <div className="tabular-nums font-medium text-forest-900 mt-0.5">
            {formatCents(net)}
          </div>
        </div>
      </div>
    </article>
  );
}
