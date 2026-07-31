import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { CompanyLogo } from "@/components/CompanyLogo";
import { PageHeader } from "@/components/PageHeader";
import { DeductionExplorer } from "@/components/DeductionExplorer";
import { HomeOfficeQuickApply } from "@/components/HomeOfficeQuickApply";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { requireBusinessManager } from "@/lib/tax/require-business-manager";
import { MASTER_DEDUCTIONS } from "@/lib/deductions/master";
import { appliesToCompany } from "@/lib/deductions/applicability";
import type { CompanyEntityType } from "@/lib/deductions/types";
import { formatCents } from "@/lib/tax/forecast";
import {
  applyHomeOffice,
  unapplyHomeOffice,
  logCharitableDonation,
} from "./actions";

type Params = Promise<{ publicId: string }>;

const SUPPORTED_ENTITIES = new Set<CompanyEntityType>([
  "sole_prop",
  "single_llc",
  "multi_llc",
  "s_corp",
  "c_corp",
  "partnership",
  "self_employed_1099",
  "nonprofit",
  "cooperative",
]);

export default async function DeductionsPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company, role } = await loadCompanyByPublicId(publicId);
  requireBusinessManager(role, publicId);

  // Coerce the company's stored entity_type string into our typed union;
  // anything we don't recognize yet falls back to null so applicability
  // defaults to the universal "All" rows.
  const entityType: CompanyEntityType | null =
    company.entity_type && SUPPORTED_ENTITIES.has(company.entity_type as CompanyEntityType)
      ? (company.entity_type as CompanyEntityType)
      : null;

  // What's already claimed this year? Drives the "Suggested
  // deductions" rail at the top: a Home Office tile that shows
  // "Apply" → modal → applied state with the sqft on file. Pattern
  // extends to Vehicle (V015) and any future big-ticket claim.
  const taxYear = new Date().getUTCFullYear();
  const { data: profile } = await supabase
    .from("business_profiles")
    .select("has_home_office, home_office_sqft, home_total_sqft")
    .eq("company_id", company.id)
    .eq("tax_year", taxYear)
    .maybeSingle();
  const homeOfficeApplied = Boolean(profile?.has_home_office);
  const homeOfficeSqft = (profile?.home_office_sqft as number | null) ?? null;
  const homeTotalSqft = (profile?.home_total_sqft as number | null) ?? null;

  // Charitable giving this year (personal §170). Drives the running
  // "given this year" tally + the earned-medal note in the section below.
  const { data: donationRows } = await supabase
    .from("charitable_donations")
    .select("amount_cents")
    .eq("user_id", user.id)
    .eq("tax_year", taxYear);
  const givenCents = (donationRows ?? []).reduce(
    (a, d) => a + Number((d as { amount_cents: number }).amount_cents || 0),
    0,
  );
  const hasGiven = (donationRows?.length ?? 0) > 0;

  // The xlsx ships an "industry" hint per row; we don't yet capture industry
  // tags on the company profile, so the gate falls open. When we add tags
  // (e.g. via a profile dropdown) the explorer narrows automatically.
  const filtered = MASTER_DEDUCTIONS.filter((d) =>
    appliesToCompany(d, { entityType, industryTags: [] }),
  );

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-6 sm:py-10">
        <PageHeader
          logo={
            <CompanyLogo
              src={company.logo_url}
              name={company.name}
              size={64}
            />
          }
          eyebrow="Deduction explorer"
          title={company.name}
        />

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="deductions" />
        </div>

        <section className="mt-6">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            What you can deduct
          </div>
          <h2 className="display mt-2 text-2xl sm:text-3xl text-forest-900 max-w-3xl">
            {filtered.length.toLocaleString()} deductions filtered for your
            entity type
            {entityType ? null : (
              <span className="text-ink-muted text-base block mt-1">
                Set your entity type in{" "}
                <a
                  href={`/c/${publicId}/profile`}
                  className="underline hover:text-forest-700"
                >
                  Profile
                </a>{" "}
                to narrow this list further.
              </span>
            )}
          </h2>
          <p className="mt-3 text-sm text-ink-soft max-w-2xl leading-relaxed">
            Sourced from IRS publications. Click any category to see the
            specific items inside. Search across every name and note. Each
            item links to the IRS source so you can verify before claiming.
          </p>
        </section>

        {/* Cross-link to the canonical "what I've claimed" view. Lives
            HERE because the explorer is the natural place to land
            after applying something, users want a single click to
            see "ok now where's my running tally?" */}
        <div className="mt-6">
          <a
            href={`/c/${publicId}/my-deductions`}
            className="inline-flex items-center gap-2 text-xs px-3 h-8 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400"
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-emerald-500"
            />
            My deductions · running total →
          </a>
        </div>

        {/* Suggested deductions, quick-apply tiles for the
            big-ticket claims that users miss most. Each tile is
            self-contained (button → modal → server action) and the
            applied state is sticky across reloads. */}
        <section className="mt-6">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700 font-medium">
            Suggested deductions
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            Apply with one click
          </h2>
          <p className="mt-1 text-sm text-ink-soft max-w-2xl leading-relaxed">
            Most tax-year-{taxYear} forecasts move the most when one of
            these is on. Fill the details once; the forecast updates
            instantly.
          </p>
          {/* Single quick-apply tile today, constrain its width so it
              reads as one deliberate card instead of a half-empty 2-col
              grid. Widen to a real grid here when a second tile lands. */}
          <div className="mt-4 sm:max-w-md">
            <HomeOfficeQuickApply
              publicId={publicId}
              applied={homeOfficeApplied}
              initialSqft={homeOfficeSqft}
              initialTotalSqft={homeTotalSqft}
              applyAction={applyHomeOffice}
              unapplyAction={unapplyHomeOffice}
            />
          </div>
        </section>

        {/* Personal & charitable deductions. The master catalog below is
            business (Schedule C). The deduction users most often ask
            "where is this?" about, gifts to a 501(c)(3), is a PERSONAL
            Schedule A itemized deduction under §170, which is exactly why
            it never appears on the business Expenses page. Surface it here
            with the real rules + where to record it. */}
        <section className="mt-8">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700 font-medium">
            Beyond the business · Schedule A
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            Charitable giving &amp; personal itemized deductions
          </h2>
          <p className="mt-1 text-sm text-ink-soft max-w-2xl leading-relaxed">
            Gifts to a qualified{" "}
            <span className="font-medium text-forest-800">501(c)(3)</span>{" "}
            charity are deductible on your personal Form 1040{" "}
            <span className="font-medium text-forest-800">Schedule A</span>{" "}
            when you itemize (IRC §170), they&apos;re not a business
            expense, which is why they don&apos;t show up on the Expenses
            page. They only lower your tax if your total itemized
            deductions beat the standard deduction.
          </p>
          <div className="mt-4 grid sm:grid-cols-3 gap-3">
            <article className="card p-5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                §170 · Cash
              </div>
              <h3 className="display mt-1 text-lg text-forest-900">
                Cash donations
              </h3>
              <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                Deductible up to 60% of AGI for gifts to public charities.
                Keep a bank record or receipt; any single gift of $250+
                needs a written acknowledgment from the charity.
              </p>
            </article>
            <article className="card p-5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                §170 · Non-cash
              </div>
              <h3 className="display mt-1 text-lg text-forest-900">
                Goods &amp; property
              </h3>
              <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                Clothing, equipment, even appreciated stock, deduct fair
                market value. Over $500 total needs Form 8283; items over
                $5,000 need a qualified appraisal.
              </p>
            </article>
            <article className="card p-5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                §170(j) · Mileage
              </div>
              <h3 className="display mt-1 text-lg text-forest-900">
                Volunteer mileage
              </h3>
              <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                Driving for a charity is deductible at 14¢/mile (plus
                parking and tolls). Your donated time and services
                aren&apos;t deductible.
              </p>
            </article>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={`/onboarding/tax-profile?next=/c/${publicId}/deductions`}
              className="btn-primary text-sm"
            >
              Record itemized deductions
            </a>
            <a
              href={`/c/${publicId}/savings-goals`}
              className="text-sm text-forest-700 hover:text-forest-900"
            >
              Charitable-bunching strategy &rarr;
            </a>
            <a
              href="https://www.irs.gov/forms-pubs/about-publication-526"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-ink-muted underline underline-offset-2 hover:text-forest-700"
            >
              IRS Pub 526
            </a>
          </div>

          {/* Log a gift → earn the Philanthropist medal. Personal §170
              giving, stored separately from business expenses so it never
              touches the forecast; the badge engine awards the medal on
              the first logged gift (pops on the next dashboard visit). */}
          <form
            action={logCharitableDonation}
            className="card mt-4 p-5 grid gap-3 sm:max-w-xl"
          >
            <input type="hidden" name="publicId" value={publicId} />
            <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
              Log a gift · earn the Philanthropist medal
            </div>
            {hasGiven ? (
              <p className="text-sm text-forest-900">
                You&apos;ve given{" "}
                <span className="font-medium">{formatCents(givenCents)}</span>{" "}
                to charity this year, thank you. The{" "}
                <span className="font-medium">Philanthropist</span> medal is
                yours. Log another anytime.
              </p>
            ) : (
              <p className="text-xs text-ink-soft leading-relaxed">
                Record a gift to a 501(c)(3) you believe in, it earns you the
                gold Philanthropist medal, and counts toward your Schedule A if
                you itemize.
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-ink-soft">Amount (USD)</span>
                <input
                  name="amount"
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  placeholder="100"
                  className="input"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-ink-soft">
                  Charity (optional)
                </span>
                <input
                  name="recipient"
                  type="text"
                  maxLength={200}
                  placeholder="e.g. American Red Cross"
                  className="input"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-soft">
              <input
                name="noncash"
                type="checkbox"
                className="size-4 rounded border border-forest-200"
              />
              Non-cash gift (goods, clothing, stock)
            </label>
            <button type="submit" className="btn-primary text-sm w-fit">
              Log donation
            </button>
          </form>
        </section>

        <DeductionExplorer
          deductions={filtered}
          totalCount={MASTER_DEDUCTIONS.length}
        />
      </section>
    </main>
  );
}
