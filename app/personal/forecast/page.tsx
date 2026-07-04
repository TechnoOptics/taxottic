import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { TrialBanner } from "@/components/TrialBanner";
import { ForecastDisclaimer } from "@/components/ForecastDisclaimer";
import { getTrialState } from "@/lib/plans/usage";
import { createClient } from "@/lib/supabase/server";
import {
  forecast,
  formatCents,
  type ForecastInput,
  type ForecastResult,
} from "@/lib/tax/forecast";
import {
  AmtTile,
  CapitalGainsTile,
  EducationCreditTile,
  EitcTile,
  ForeignExclusionTile,
  RetirementRecommendationTile,
  RetirementSavingsTile,
  SaversCreditTile,
  StudentLoanInterestTile,
  W4NudgeTile,
} from "@/components/forecast/BenefitTiles";
import { buildPersonalForecastInput } from "@/lib/tax/personal-forecast-input";

/**
 * Personal-mode forecast for W-2 / wage-earner users.
 *
 * The same forecast engine drives this, we just feed it zero
 * Schedule C income and the user's W-2 wages + spouse W-2 (already
 * supported, including household-level Additional Medicare and NIIT).
 *
 * No company is required. If the user has business income they
 * eventually create a company; that flips them to 'business' filer
 * type and kicks them over to /c/[publicId]/forecast.
 */
export default async function PersonalForecastPage() {
  const { admin, user } = await requireUserWithAdmin();
  const supabase = await createClient();
  const taxYear = new Date().getUTCFullYear();
  const trial = await getTrialState(supabase, user.id);

  const { data: taxProfile } = await admin
    .from("tax_profiles")
    .select("*")
    .eq("user_id", user.id)
    .eq("tax_year", taxYear)
    .maybeSingle();
  if (!taxProfile) {
    redirect(`/onboarding/tax-profile?next=/personal/forecast`);
  }

  // Item 14: fold the personal expense tracker into the forecast. When the
  // user has logged expenses in a deduction category, that live total takes
  // precedence over the static figure typed into the tax profile (an override,
  // not a sum, so tracked + typed can't double-count).
  const { data: personalExpenseRows } = await admin
    .from("personal_expenses")
    .select("category, amount_cents")
    .eq("user_id", user.id)
    .eq("tax_year", taxYear);
  const input: ForecastInput = buildPersonalForecastInput(
    taxProfile,
    personalExpenseRows ?? [],
    taxYear,
  );

  const result: ForecastResult = forecast(input);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Personal · Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          Your year-end picture
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-xl leading-relaxed">
          Based on your filing status, household W-2 wages, and itemized
          totals. We project to year-end and apply 2025 federal rules. Update
          your tax profile any time to refine.
        </p>

        <TrialBanner trial={trial} />

        <div className="card mt-7 p-6 sm:p-9">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Year-end estimate
          </div>
          <h2 className="display mt-2 text-2xl sm:text-3xl text-forest-900 leading-tight">
            You&apos;re projecting{" "}
            <span className="gold-shine">{formatCents(result.totalTaxCents)}</span>{" "}
            in total federal + state tax for the year.
          </h2>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat
              label="Already paid (withholding + estimates)"
              value={formatCents(result.alreadyPaidCents)}
            />
            {/* Bidirectional balance: show the side that's actually
                non-zero. refundCents > 0 means the user has overpaid
                (withholding + estimates exceed total tax) and gets
                money back; stillOwedCents > 0 means they owe a
                top-up. Previously the page hard-coded
                `Math.max(stillOwedCents, 0)` which always rendered $0
                next to a "Refund expected" label, the actual refund
                amount was never computed. */}
            {result.refundCents > 0 ? (
              <Stat
                label="Refund expected"
                value={formatCents(result.refundCents)}
                accent
              />
            ) : (
              <Stat
                label="Still owed"
                value={formatCents(result.stillOwedCents)}
                accent
              />
            )}
            <Stat
              label="Marginal rate"
              value={(result.marginalRate * 100).toFixed(1) + "%"}
            />
          </div>
        </div>

        {/* Benefits / recommendations strip. Each tile renders nothing
            when the relevant value is zero, so the strip naturally
            adapts to what the user has reported - someone with no
            retirement contributions and no LTCG sees just the W-4
            nudge (if applicable); someone with the full suite sees
            five tiles. */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <EitcTile result={result} />
          <EducationCreditTile result={result} />
          <RetirementSavingsTile result={result} />
          <RetirementRecommendationTile result={result} />
          <W4NudgeTile result={result} />
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <SaversCreditTile result={result} />
          <AmtTile result={result} />
          <CapitalGainsTile result={result} />
          <ForeignExclusionTile result={result} />
          <StudentLoanInterestTile result={result} />
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Federal income tax">
            <BigNumber>{formatCents(result.federalIncomeTaxCents)}</BigNumber>
            <KV label="Taxable income" value={formatCents(result.taxableIncomeCents)} />
            {result.childAndDependentCreditsCents > 0 ? (
              <KV
                label="Family credits"
                value={`- ${formatCents(result.childAndDependentCreditsCents)}`}
              />
            ) : null}
            <KV label="Effective rate" value={(result.overallEffectiveRate * 100).toFixed(1) + "%"} />
          </Card>
          <Card title="State">
            <BigNumber>{formatCents(result.stateTaxCents)}</BigNumber>
            <KV label="State" value={taxProfile.state_code ?? "Not set"} />
            <KV label="Method" value="Flat-rate estimate" />
          </Card>
          <Card title="Other surtaxes">
            <BigNumber>
              {formatCents(result.additionalMedicareCents + result.niitCents)}
            </BigNumber>
            <KV
              label="Additional Medicare 0.9%"
              value={formatCents(result.additionalMedicareCents)}
            />
            <KV label="NIIT 3.8%" value={formatCents(result.niitCents)} />
          </Card>
        </div>

        {result.hints.length > 0 ? (
          <div className="card mt-6 p-6 border-gold-300/60">
            <h2 className="display text-base text-forest-900">Notes from Bella</h2>
            <ul className="mt-3 grid gap-2">
              {result.hints.map((h, i) => (
                <li key={i} className="text-sm text-ink-soft leading-relaxed flex gap-2">
                  <span className="text-gold-700">•</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/personal/expenses"
            className="card card-hover p-5 flex items-start gap-3"
          >
            <div>
              <div className="display text-base text-forest-900">
                Track your deductions
              </div>
              <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                Log charitable, medical, mortgage, SALT, student loan, and
                education expenses. They flow straight into this forecast.
              </p>
            </div>
            <span className="ml-auto text-ink-muted">→</span>
          </Link>
          <Link
            href="/personal/export"
            className="card card-hover p-5 flex items-start gap-3"
          >
            <div>
              <div className="display text-base text-forest-900">
                Export annual summary
              </div>
              <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                A print-ready year-end sheet with your forecast and every logged
                deduction. Save as PDF for your preparer.
              </p>
            </div>
            <span className="ml-auto text-ink-muted">→</span>
          </Link>
          <Link
            href="/onboarding/tax-profile?next=/personal/forecast"
            className="card card-hover p-5 flex items-start gap-3"
          >
            <div>
              <div className="display text-base text-forest-900">
                Update household profile
              </div>
              <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                W-2 wages, withholding, dependents, itemized totals.
              </p>
            </div>
            <span className="ml-auto text-ink-muted">→</span>
          </Link>
          <Link
            href="/onboarding/new-company?next=/dashboard"
            className="card card-hover p-5 flex items-start gap-3 border-gold-300/60"
          >
            <div>
              <div className="display text-base text-forest-900">
                Started a side hustle?
              </div>
              <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                Add a business and unlock Schedule C forecasting, quarterly
                estimates, and Plaid bank sync.
              </p>
            </div>
            <span className="ml-auto text-ink-muted">→</span>
          </Link>
        </div>

        <p className="mt-12 text-[11px] leading-relaxed text-ink-muted max-w-2xl">
          Personal forecast uses IRS-published federal brackets for tax year{" "}
          {taxYear} (Rev. Proc. 2025-32, reflecting the One Big Beautiful Bill
          amendments), household-level Additional Medicare (Form 8959), Net
          Investment Income Tax (Form 8960), and a curated state rate.
          Educational guidance only, talk with a CPA for binding decisions.
        </p>

        <div className="mt-6">
          <ForecastDisclaimer variant="card" />
        </div>
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
            ? "text-[10px] uppercase tracking-[0.2em] text-gold-300"
            : "text-[10px] uppercase tracking-[0.2em] text-gold-700"
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
      <h2 className="text-xs uppercase tracking-[0.2em] text-gold-700">{title}</h2>
      {children}
    </div>
  );
}

function BigNumber({ children }: { children: React.ReactNode }) {
  return <div className="display text-3xl text-forest-900 mt-2">{children}</div>;
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1.5 border-b last:border-b-0 border-forest-50">
      <span className="text-ink-muted">{label}</span>
      <span className="text-forest-900 font-medium">{value}</span>
    </div>
  );
}
