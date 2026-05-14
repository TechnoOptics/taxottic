import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { ProGate } from "@/components/ProGate";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { getActiveFeatureGates } from "@/lib/plans/usage";
import { PreparerPanel } from "./PreparerPanel";
import {
  acceptFirmInitiatedEngagement,
  cancelEngagement,
  declineFirmInitiatedEngagement,
  endEngagement,
  requestEngagement,
  searchFirms,
} from "./actions";

type Params = Promise<{ publicId: string }>;

export default async function PreparerPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company, isManager } =
    await loadCompanyByPublicId(publicId);

  const { gates } = await getActiveFeatureGates(supabase, user.id);
  if (!gates.taxPreparer) {
    return (
      <main id="main" className="min-h-screen">
        <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
        <section className="max-w-3xl mx-auto px-6 py-10">
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
            {company.public_id} <span className="text-gold-700">·</span> Tax preparer
          </div>
          <h1 className="display mt-2 text-3xl text-forest-900">
            {company.name}
          </h1>
          <div aria-hidden="true" className="gold-flourish mt-3">
            <span />
          </div>
          <div className="mt-6">
            <CompanyNav publicId={publicId} active="preparer" />
          </div>
          <ProGate
            feature="Tax-preparer engagements"
            pitch="Search the directory of accounting firms on Taxottic Enterprise and engage one as your CPA. They get read-only access to your books for the agreed tax year, you stay in control, and you can end the engagement anytime."
            perks={[
              "Search firms by name + city + state",
              "Engage by tax year + service kind (tax prep, audit, advisory)",
              "Transparency view: see exactly which fields the firm can read",
              "Plus everything in Pro: Bella AI, bank connections, team chat",
            ]}
            reason="tax_preparer"
          />
        </section>
      </main>
    );
  }

  // Pull every engagement on this company. RLS lets a member of the
  // company see them all (including pending and historical), and the
  // joined firm row is publicly readable when status='active'.
  const { data: engagements } = await supabase
    .from("firm_engagements")
    .select(
      "id, firm_id, tax_year, kind, status, requested_at, requested_by_side, client_note, firm_note, scope_summary, ended_at, firm:firms(public_id, name, logo_url, accent_color, city, state_code, website, status)",
    )
    .eq("company_id", company.id)
    .order("status", { ascending: true })
    .order("tax_year", { ascending: false })
    .order("requested_at", { ascending: false });

  type FirmRow = {
    public_id: string;
    name: string;
    logo_url: string | null;
    accent_color: string | null;
    city: string | null;
    state_code: string | null;
    website: string | null;
    status: string;
  };
  type EngRow = {
    id: string;
    firm_id: string;
    tax_year: number;
    kind: string;
    status: string;
    requested_at: string;
    requested_by_side: string;
    client_note: string | null;
    firm_note: string | null;
    scope_summary: string | null;
    ended_at: string | null;
    firm: FirmRow | FirmRow[] | null;
  };

  const rows = ((engagements ?? []) as unknown as EngRow[]).map((e) => ({
    ...e,
    firm: (Array.isArray(e.firm) ? e.firm[0] : e.firm) ?? null,
  }));

  const taxYear = new Date().getUTCFullYear();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-700">·</span>{" "}
          Tax preparer
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          {company.name}
        </h1>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="preparer" />
        </div>

        <PreparerPanel
          companyId={company.id}
          companyPublicId={publicId}
          companyName={company.name}
          isManager={isManager}
          defaultTaxYear={taxYear}
          engagements={rows}
          searchAction={searchFirms}
          requestAction={requestEngagement}
          cancelAction={cancelEngagement}
          acceptAction={acceptFirmInitiatedEngagement}
          declineAction={declineFirmInitiatedEngagement}
          endAction={endEngagement}
        />
      </section>
    </main>
  );
}
