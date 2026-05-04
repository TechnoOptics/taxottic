import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { CompanyLogo } from "@/components/CompanyLogo";
import { DeductionExplorer } from "@/components/DeductionExplorer";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { MASTER_DEDUCTIONS } from "@/lib/deductions/master";
import { appliesToCompany } from "@/lib/deductions/applicability";
import type { CompanyEntityType } from "@/lib/deductions/types";

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
  const { user, company } = await loadCompanyByPublicId(publicId);

  // Coerce the company's stored entity_type string into our typed union;
  // anything we don't recognize yet falls back to null so applicability
  // defaults to the universal "All" rows.
  const entityType: CompanyEntityType | null =
    company.entity_type && SUPPORTED_ENTITIES.has(company.entity_type as CompanyEntityType)
      ? (company.entity_type as CompanyEntityType)
      : null;

  // The xlsx ships an "industry" hint per row; we don't yet capture industry
  // tags on the company profile, so the gate falls open. When we add tags
  // (e.g. via a profile dropdown) the explorer narrows automatically.
  const filtered = MASTER_DEDUCTIONS.filter((d) =>
    appliesToCompany(d, { entityType, industryTags: [] }),
  );

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center gap-4">
          <CompanyLogo
            src={company.logo_url}
            name={company.name}
            size={48}
          />
          <div>
            <h1 className="display text-3xl text-forest-900">{company.name}</h1>
            <div className="text-xs text-ink-muted mt-0.5 tracking-wide">
              {company.public_id}
              <span className="text-gold-500"> · </span>
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

        <DeductionExplorer
          deductions={filtered}
          totalCount={MASTER_DEDUCTIONS.length}
        />
      </section>
    </main>
  );
}
