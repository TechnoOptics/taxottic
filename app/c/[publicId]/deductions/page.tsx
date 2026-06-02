import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { CompanyLogo } from "@/components/CompanyLogo";
import { DeductionExplorer } from "@/components/DeductionExplorer";
import { HomeOfficeQuickApply } from "@/components/HomeOfficeQuickApply";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { MASTER_DEDUCTIONS } from "@/lib/deductions/master";
import { appliesToCompany } from "@/lib/deductions/applicability";
import type { CompanyEntityType } from "@/lib/deductions/types";
import { applyHomeOffice, unapplyHomeOffice } from "./actions";

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
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

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
        <div className="flex items-center gap-4">
          <CompanyLogo
            src={company.logo_url}
            name={company.name}
            size={48}
          />
          <div>
            <h1 className="display text-3xl text-forest-900">{company.name}</h1>
            <div className="text-xs text-ink-muted mt-0.5 tracking-wide">
              Deduction explorer
            </div>
          </div>
        </div>

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
            after applying something — users want a single click to
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

        {/* Suggested deductions — quick-apply tiles for the
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
          <div className="mt-4 grid sm:grid-cols-2 gap-3">
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

        <DeductionExplorer
          deductions={filtered}
          totalCount={MASTER_DEDUCTIONS.length}
        />
      </section>
    </main>
  );
}
