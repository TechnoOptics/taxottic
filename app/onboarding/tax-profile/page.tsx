import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { W2Fieldset } from "@/components/W2Fieldset";
import { PriorYearUploader } from "@/components/PriorYearUploader";
import { US_STATES } from "@/data/us-states";
import {
  STANDARD_DEDUCTION_2025,
  type FilingStatus,
} from "@/lib/tax/constants-2025";
import { formatCents } from "@/lib/tax/forecast";
import { saveTaxProfile } from "./actions";

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
  const { data: existing } = await supabase
    .from("tax_profiles")
    .select(
      "filing_status, state_code, spouse_income_cents, dependents, dependents_under_17, age, is_blind, itemize, itemized_total_cents, estimated_payments_cents, owner_w2_wages_cents, owner_w2_withheld_cents, owner_w2_ss_wages_cents, spouse_w2_wages_cents, spouse_w2_withheld_cents, spouse_w2_ss_wages_cents",
    )
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
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-2xl mx-auto px-6 py-12">
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
            <select
              name="filing_status"
              required
              className="input"
              defaultValue={startingFilingStatus}
            >
              {FILING_STATUSES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Section>

          <Section
            title="State of residence"
            sub="Used for the state-tax estimate."
          >
            <select
              name="state_code"
              className="input"
              defaultValue={existing?.state_code ?? ""}
            >
              <option value="">Select state</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
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
            <p className="text-xs text-ink-muted leading-relaxed">
              Most filers take the standard deduction (
              {formatCents(STANDARD_DEDUCTION_2025[startingFilingStatus])} for
              your filing status, before age / blind add-ons). Itemize only if
              your mortgage interest, state and local taxes (capped at
              $10,000), charitable gifts, and large medical expenses together
              exceed that.
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
