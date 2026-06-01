import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { W2Fieldset } from "@/components/W2Fieldset";
import { PriorYearUploader } from "@/components/PriorYearUploader";
import { US_STATES } from "@/data/us-states";
import { type FilingStatus } from "@/lib/tax/constants-2025";
import { getTaxYearConstants } from "@/lib/tax/constants";
import { formatCents } from "@/lib/tax/forecast";
import { saveTaxProfile } from "./actions";
import { SelectMenu } from "@/components/ui/SelectMenu";

const FILING_STATUSES: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married, filing jointly" },
  { value: "married_filing_separately", label: "Married, filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_widow", label: "Qualifying surviving spouse" },
];

export default async function TaxProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { supabase, user } = await requireUser();
  const { next } = await searchParams;
  const taxYear = new Date().getUTCFullYear();

  // supabase-js parses the select string at the type level via template
  // literals - it must be a literal, not a runtime-built one.
  // Pulling `*` rather than enumerating every column. The form needs
  // ~30 fields now between the original W-2 / itemized / dependents
  // set and the 17 new structured benefit inputs (retirement, SE
  // health, capital gains, foreign earned income, student loan /
  // education, itemized sub-types, § 179, energy + EV credits, PTC
  // advance, AOTC claim flag). Enumerating each here made the select
  // string an untyped 600-character literal that broke supabase-js's
  // type narrowing; `*` works correctly and is no slower because the
  // table is narrow.
  const { data: existing } = await supabase
    .from("tax_profiles")
    .select("*")
    .eq("user_id", user.id)
    .eq("tax_year", taxYear)
    .maybeSingle();

  const startingFilingStatus =
    (existing?.filing_status as FilingStatus | undefined) ?? "single";

  // Have they already uploaded any prior-year docs? If so, hide the
  // upload card by default - it's a one-and-done flow per year.
  const { data: priorDocs } = await supabase
    .from("prior_year_documents")
    .select("id, doc_type, applied_at")
    .eq("user_id", user.id)
    .eq("tax_year", taxYear - 1);
  const priorDocsExist = !!priorDocs && priorDocs.length > 0;
  const priorDocsApplied = priorDocs?.some((d) => d.applied_at) ?? false;

  // Pick a company to bind business-scoped docs to.
  const { data: primaryCompany } = await supabase
    .from("companies")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Personal tax profile
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          A few details so Bella can forecast accurately.
        </h1>
        <p className="mt-3 text-sm text-ink-soft max-w-lg">
          For tax year {taxYear}. You can update these any time. Stored
          privately on your account; only you and super-admins can read them.
        </p>

        {/* Prior-year shortcut. If the user has last year's W-2,
            1099s, and Schedule C, dropping them in here lets us
            extract the totals via Bella's vision and pre-populate
            both the tax profile AND a 12-month income/expense
            baseline so the forecast starts from a realistic number
            instead of zero. The form below stays available for
            anyone who'd rather type it in. */}
        <details
          open={!priorDocsApplied}
          className="mt-8 card p-6 sm:p-7 group bg-cream/40 border-gold-200/60"
        >
          <summary className="cursor-pointer list-none flex items-start justify-between gap-3 select-none">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
                Pre-fill from last year (recommended)
              </div>
              <h2 className="display mt-1 text-xl text-forest-900">
                Drop in {taxYear - 1}'s tax docs and we'll do the rest.
              </h2>
              <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                Bella reads your W-2, every 1099, and your Schedule C,
                pulls the totals, and uses them to seed your {taxYear}{" "}
                forecast. Five minutes of upload usually beats an hour
                of typing. Files aren't stored, only the extracted
                numbers.
              </p>
              {priorDocsExist && !priorDocsApplied ? (
                <p className="mt-2 text-xs text-gold-700">
                  You have {priorDocs!.length} document
                  {priorDocs!.length === 1 ? "" : "s"} uploaded but not
                  yet applied. Click Apply below to push them into your
                  forecast.
                </p>
              ) : null}
              {priorDocsApplied ? (
                <p className="mt-2 text-xs text-emerald-800">
                  Prior year is applied. Open this card to add more
                  docs.
                </p>
              ) : null}
            </div>
            <svg
              className="size-5 text-forest-700 transition-transform group-open:rotate-180 shrink-0"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 8l4 4 4-4"
              />
            </svg>
          </summary>
          <div className="mt-5">
            <PriorYearUploader
              companyId={primaryCompany?.id ?? null}
              defaultTaxYear={taxYear - 1}
            />
          </div>
        </details>

        <form
          action={async (fd) => {
            "use server";
            await saveTaxProfile(fd, next ?? "/dashboard");
          }}
          className="mt-8 grid gap-6"
        >
          <input type="hidden" name="tax_year" value={taxYear} />

          <Section
            title="Filing status"
            sub="How you'll file your federal return."
          >
            <SelectMenu
              name="filing_status"
              required
              ariaLabel="Filing status"
              defaultValue={startingFilingStatus}
              options={FILING_STATUSES.map((f) => ({
                value: f.value,
                label: f.label,
              }))}
            />
          </Section>

          <Section
            title="State of residence"
            sub="Used for the state-tax estimate."
          >
            <SelectMenu
              name="state_code"
              ariaLabel="State of residence"
              placeholder="Select state"
              defaultValue={existing?.state_code ?? ""}
              options={[
                { value: "", label: "Select state" },
                ...US_STATES.map((s) => ({ value: s.code, label: s.name })),
              ]}
            />
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Section
              title="Total dependents"
              sub="Anyone you claim on your return."
            >
              <input
                name="dependents"
                type="number"
                min={0}
                className="input"
                defaultValue={existing?.dependents ?? 0}
              />
            </Section>
            <Section
              title="Of those, kids under 17"
              sub="$2,000 Child Tax Credit each. Others get a $500 credit."
            >
              <input
                name="dependents_under_17"
                type="number"
                min={0}
                className="input"
                defaultValue={existing?.dependents_under_17 ?? 0}
              />
            </Section>
          </div>

          <Section title="Your age" sub="Affects the standard deduction.">
            <input
              name="age"
              type="number"
              min={0}
              max={120}
              className="input"
              defaultValue={existing?.age ?? ""}
              placeholder="e.g. 34"
            />
          </Section>

          {/* Owner W-2 wages: many self-employed people moonlight a day job.
              W2Fieldset wraps the W-2 OCR uploader, so dropping a PDF / photo
              auto-fills the three boxes below it. The previous version of
              this page rendered raw DollarFields and silently dropped the
              uploader, forcing users to retype data the OCR had already
              extracted. */}
          <W2Fieldset
            who="owner"
            legend="Your W-2 (if you also work a day job)"
            description="Many side-business owners also have a W-2. We need this so the forecast doesn't double-count income or miss withholding you've already paid. Drop in your W-2 PDF or photo and we'll fill the boxes; leave at $0 if you don't have one."
            fieldNames={{
              wages: "owner_w2_wages",
              withheld: "owner_w2_withheld",
              ssWages: "owner_w2_ss_wages",
            }}
            initial={{
              wagesCents: existing?.owner_w2_wages_cents ?? 0,
              withheldCents: existing?.owner_w2_withheld_cents ?? 0,
              ssWagesCents: existing?.owner_w2_ss_wages_cents ?? 0,
            }}
            ssHint="Box 3 of your W-2"
          />

          {/* Spouse: only meaningful if MFJ; we still capture it because some
              people file MFS and want to model the joint household. */}
          <W2Fieldset
            who="spouse"
            legend="Spouse W-2 (if applicable)"
            description="Only meaningful when you file jointly. Drop in their W-2 to auto-fill, or leave at $0 if it doesn't apply."
            fieldNames={{
              wages: "spouse_w2_wages",
              withheld: "spouse_w2_withheld",
              ssWages: "spouse_w2_ss_wages",
            }}
            initial={{
              wagesCents:
                existing?.spouse_w2_wages_cents ??
                existing?.spouse_income_cents ??
                0,
              withheldCents: existing?.spouse_w2_withheld_cents ?? 0,
              ssWagesCents: existing?.spouse_w2_ss_wages_cents ?? 0,
            }}
            ssHint="Box 3 of their W-2"
          />

          <Section
            title="Estimated payments already made"
            sub="Federal estimated tax (Form 1040-ES) you've sent in for this year."
          >
            <input
              name="estimated_payments"
              type="text"
              inputMode="decimal"
              className="input"
              placeholder="$0"
              defaultValue={
                existing?.estimated_payments_cents
                  ? (existing.estimated_payments_cents / 100).toFixed(0)
                  : ""
              }
            />
          </Section>

          {/* Standard vs itemized. We show the user their estimated standard
              deduction up-front so they can decide informed, then collect
              an itemized total only if they choose to itemize. */}
          <fieldset className="grid gap-3 border-t border-forest-100 pt-5">
            <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
              Deduction
            </legend>
            {/* Read the standard deduction off the SAME year-aware
                constants bundle the forecast engine uses, so the copy
                here and the math there agree. The previous import
                pinned this to STANDARD_DEDUCTION_2025 (`$15,000`
                Single) while the engine for taxYear=2026 was using
                $16,100 — the May 2026 round-2 audit caught the gap. */}
            <p className="text-xs text-ink-muted leading-relaxed">
              Most filers take the standard deduction (
              {formatCents(
                getTaxYearConstants(taxYear).STANDARD_DEDUCTION[
                  startingFilingStatus
                ],
              )}{" "}
              for your filing status, before age / blind add-ons). Itemize
              only if your mortgage interest, state and local taxes (capped
              at $10,000), charitable gifts, and large medical expenses
              together exceed that.
            </p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="itemize"
                defaultChecked={existing?.itemize ?? false}
                className="mt-1 size-4 accent-forest-800"
              />
              <span className="text-sm text-ink-soft">
                I plan to itemize deductions instead of taking the standard
                deduction.
              </span>
            </label>
            <DollarField
              name="itemized_total"
              label="Estimated itemized total (only if itemizing)"
              defaultCents={existing?.itemized_total_cents ?? 0}
              hint="SALT + mortgage interest + charitable + qualifying medical"
            />
            {/* Optional sub-type breakdown. The engine warns about the
                SALT cap separately when the user fills in itemized_salt,
                so collecting it is high-ROI even if they leave the others
                blank. All four are optional - leaving them empty stores
                NULL (meaning "not broken out") rather than $0. */}
            <details className="rounded-lg border border-forest-100 bg-cream/40 p-4">
              <summary className="cursor-pointer text-sm font-medium text-forest-800">
                Break it out (optional, helps us warn about SALT-cap waste)
              </summary>
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                <DollarField
                  name="itemized_salt"
                  label="State + local taxes (SALT)"
                  defaultCents={existing?.itemized_salt_cents ?? 0}
                  hint="Capped at $10,000 ($5,000 MFS) - we'll flag if you exceed it"
                />
                <DollarField
                  name="itemized_mortgage_interest"
                  label="Home mortgage interest"
                  defaultCents={existing?.itemized_mortgage_interest_cents ?? 0}
                />
                <DollarField
                  name="itemized_charity"
                  label="Charitable contributions"
                  defaultCents={existing?.itemized_charity_cents ?? 0}
                />
                <DollarField
                  name="itemized_medical"
                  label="Qualifying medical expenses"
                  defaultCents={existing?.itemized_medical_cents ?? 0}
                  hint="Only the portion that exceeds 7.5% of AGI is deductible"
                />
              </div>
            </details>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="is_blind"
                defaultChecked={existing?.is_blind ?? false}
                className="mt-1 size-4 accent-forest-800"
              />
              <span className="text-sm text-ink-soft">
                I qualify as legally blind (additional standard deduction).
              </span>
            </label>
          </fieldset>

          {/* ============ Retirement contributions (item #1) ============ */}
          <fieldset className="grid gap-3 border-t border-forest-100 pt-5">
            <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
              Retirement
            </legend>
            <p className="text-xs text-ink-muted leading-relaxed">
              The single biggest tax-saving lever. Every dollar you
              contribute to a Solo 401(k) / SEP / Traditional IRA / HSA
              comes off your taxable income up to the per-account
              limit. Roth IRA contributions don&apos;t deduct but
              count toward the Saver&apos;s Credit. Use what you have
              actually contributed (or plan to contribute) for the
              year - the forecast will refresh as you update.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <DollarField
                name="solo_401k_contribution"
                label="Solo 401(k) — total (employee + employer)"
                defaultCents={
                  existing?.solo_401k_contribution_cents ?? 0
                }
                hint="2026 combined limit: $70,000 ($77,500 if you're 50+)"
              />
              <DollarField
                name="sep_ira_contribution"
                label="SEP-IRA"
                defaultCents={existing?.sep_ira_contribution_cents ?? 0}
                hint="Up to 25% of net SE earnings, $70,000 max for 2026"
              />
              <DollarField
                name="traditional_ira_contribution"
                label="Traditional IRA"
                defaultCents={
                  existing?.traditional_ira_contribution_cents ?? 0
                }
                hint="2026 limit: $7,500 ($8,500 if 50+). Deductibility may phase out at higher AGI"
              />
              <DollarField
                name="roth_ira_contribution"
                label="Roth IRA"
                defaultCents={
                  existing?.roth_ira_contribution_cents ?? 0
                }
                hint="Same $7,500 limit; not deductible but counts toward the Saver's Credit"
              />
              <DollarField
                name="hsa_contribution"
                label="HSA"
                defaultCents={existing?.hsa_contribution_cents ?? 0}
                hint="2026: $4,400 self-only / $8,750 family. Requires HDHP coverage"
              />
            </div>
          </fieldset>

          {/* ============ Health insurance (item #2) ============ */}
          <fieldset className="grid gap-3 border-t border-forest-100 pt-5">
            <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
              Health insurance
            </legend>
            <p className="text-xs text-ink-muted leading-relaxed">
              Self-employed filers who buy their own health insurance
              get an above-the-line deduction for the full premium
              (limited to SE earnings). If you&apos;re W-2 only with an
              employer plan, leave this at $0.
            </p>
            <DollarField
              name="se_health_insurance"
              label="Self-employed health insurance premiums (annual)"
              defaultCents={existing?.se_health_insurance_cents ?? 0}
            />
          </fieldset>

          {/* ============ Investments (item #4) ============ */}
          <fieldset className="grid gap-3 border-t border-forest-100 pt-5">
            <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
              Investment income
            </legend>
            <p className="text-xs text-ink-muted leading-relaxed">
              Long-term capital gains (assets held more than a year)
              and qualified dividends are taxed at the preferential
              0% / 15% / 20% rates rather than ordinary income rates.
              We&apos;ll stack them correctly so you&apos;re not
              taxed twice or at the wrong rate.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <DollarField
                name="long_term_capital_gains"
                label="Long-term capital gains (annual)"
                defaultCents={
                  existing?.long_term_capital_gains_cents ?? 0
                }
                hint="Net realized gains on assets held > 1 year"
              />
              <DollarField
                name="qualified_dividends"
                label="Qualified dividends (annual)"
                defaultCents={existing?.qualified_dividends_cents ?? 0}
              />
            </div>
          </fieldset>

          {/* ============ Foreign earned income (item #11) ============ */}
          <fieldset className="grid gap-3 border-t border-forest-100 pt-5">
            <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
              Foreign earned income
            </legend>
            <p className="text-xs text-ink-muted leading-relaxed">
              U.S. citizens working abroad can exclude up to $132,900
              (2026) of foreign earned income from gross income via
              § 911. Eligibility requires either the bona-fide
              residence test or the physical-presence test (330 days
              in a 12-month period). Leave at $0 if it doesn&apos;t
              apply.
            </p>
            <DollarField
              name="foreign_earned_income"
              label="Foreign earned income (annual)"
              defaultCents={existing?.foreign_earned_income_cents ?? 0}
              hint="2026 exclusion cap: $132,900"
            />
          </fieldset>

          {/* ============ Education (item #6) ============ */}
          <fieldset className="grid gap-3 border-t border-forest-100 pt-5">
            <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
              Education
            </legend>
            <p className="text-xs text-ink-muted leading-relaxed">
              Student loan interest is deductible above-the-line up to
              $2,500/year (with an AGI phase-out). Tuition + qualified
              fees can claim either the American Opportunity Credit
              (first 4 years undergrad, $2,500 max, 40% refundable) or
              the Lifetime Learning Credit (any education, $2,000 max,
              non-refundable).
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <DollarField
                name="student_loan_interest"
                label="Student loan interest paid"
                defaultCents={
                  existing?.student_loan_interest_cents ?? 0
                }
                hint="Up to $2,500; phases out above $85k single / $175k MFJ"
              />
              <DollarField
                name="qualified_education_expenses"
                label="Qualified tuition + fees"
                defaultCents={
                  existing?.qualified_education_expenses_cents ?? 0
                }
                hint="Counts toward AOTC or Lifetime Learning Credit"
              />
            </div>
            <label className="flex items-start gap-3 cursor-pointer mt-1">
              <input
                type="checkbox"
                name="claim_aotc"
                defaultChecked={existing?.claim_aotc ?? false}
                className="mt-1 size-4 accent-forest-800"
              />
              <span className="text-sm text-ink-soft">
                Claim the American Opportunity Credit (the student is
                in their first 4 years of undergrad, enrolled at least
                half-time, has no felony drug conviction, and hasn&apos;t
                claimed AOTC for 4 prior years). If unchecked,
                we&apos;ll apply the Lifetime Learning Credit instead.
              </span>
            </label>
          </fieldset>

          {/* ============ Business credits (item #7) ============ */}
          <fieldset className="grid gap-3 border-t border-forest-100 pt-5">
            <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
              Business equipment (§ 179)
            </legend>
            <p className="text-xs text-ink-muted leading-relaxed">
              If you bought equipment, vehicles, software, or other
              qualifying business property and want to expense it all
              in the year of purchase (rather than depreciating over
              several years), enter the total cost here. OBBBA raised
              the 2026 cap to $2,560,000.
            </p>
            <DollarField
              name="section_179_expense"
              label="§ 179 expensing election (annual)"
              defaultCents={existing?.section_179_expense_cents ?? 0}
              hint="2026 cap: $2,560,000; phase-out starts at $4,090,000 of purchases"
            />
          </fieldset>

          {/* ============ Other credits (item #12) ============ */}
          <fieldset className="grid gap-3 border-t border-forest-100 pt-5">
            <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
              Energy + clean-vehicle credits
            </legend>
            <p className="text-xs text-ink-muted leading-relaxed">
              Solar panels, geothermal, residential batteries, EV /
              fuel-cell vehicles. These are non-refundable credits
              applied directly against tax owed.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <DollarField
                name="residential_energy_credit"
                label="Residential energy credit (§ 25D)"
                defaultCents={
                  existing?.residential_energy_credit_cents ?? 0
                }
                hint="30% of solar / geothermal / wind / battery installation"
              />
              <DollarField
                name="ev_credit"
                label="Clean vehicle credit (§ 30D / § 25E)"
                defaultCents={existing?.ev_credit_cents ?? 0}
                hint="Up to $7,500 new / $4,000 used; income + vehicle limits apply"
              />
            </div>
          </fieldset>

          {/* ============ Premium Tax Credit reconciliation (item #9) ============ */}
          <fieldset className="grid gap-3 border-t border-forest-100 pt-5">
            <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
              Marketplace health insurance
            </legend>
            <p className="text-xs text-ink-muted leading-relaxed">
              If you bought health insurance through healthcare.gov or
              a state marketplace and received advance Premium Tax
              Credit payments, you reconcile them on Form 8962 at
              filing time. We&apos;ll surface a heads-up so you
              don&apos;t get surprised; the actual reconciliation math
              uses your final AGI and is beyond the scope of the
              forecast.
            </p>
            <DollarField
              name="ptc_advance_payments"
              label="Advance Premium Tax Credit payments received (annual)"
              defaultCents={existing?.ptc_advance_payments_cents ?? 0}
            />
          </fieldset>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button className="btn-primary">Save and continue</button>
            <a
              href={next ?? "/dashboard"}
              className="btn-ghost"
            >
              Skip for now
            </a>
          </div>
        </form>
      </section>
    </main>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <div>
        <div className="text-sm font-medium text-forest-800">{title}</div>
        {sub ? <div className="text-xs text-ink-muted mt-0.5">{sub}</div> : null}
      </div>
      {children}
    </label>
  );
}

function DollarField({
  name,
  label,
  defaultCents,
  hint,
}: {
  name: string;
  label: string;
  defaultCents: number;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-forest-800">{label}</span>
      <input
        name={name}
        type="text"
        inputMode="decimal"
        className="input"
        placeholder="$0"
        defaultValue={
          defaultCents > 0 ? (defaultCents / 100).toFixed(0) : ""
        }
      />
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}
