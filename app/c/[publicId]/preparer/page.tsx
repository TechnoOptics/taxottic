import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { ProGate } from "@/components/ProGate";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { requireBusinessManager } from "@/lib/tax/require-business-manager";
import { getActiveFeatureGates } from "@/lib/plans/usage";
import { createServiceClient } from "@/lib/supabase/server";
import { PreparerPanel } from "./PreparerPanel";
import { FromYourFirmPanel } from "@/components/client/FromYourFirmPanel";
import { FromYourFirmRealtime } from "@/components/client/FromYourFirmRealtime";
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
  const { supabase, user, company, isManager, role } =
    await loadCompanyByPublicId(publicId);
  requireBusinessManager(role, publicId);

  const { gates } = await getActiveFeatureGates(supabase, user.id);
  if (!gates.taxPreparer) {
    return (
      <main id="main" className="min-h-screen">
        <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
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

  // Phase 9: collect documents / meetings / invoices the firm has
  // sent for the active engagement(s). We use the service-role
  // client so a freshly-engaged company that doesn't yet have a
  // company_member row doesn't 404 against RLS. Each row is
  // already gated by firm-engagement RLS so the data is correct
  // to surface to the company manager either way.
  const activeEngagementIds = rows
    .filter((e) => e.status === "active")
    .map((e) => e.id);
  const adminClient = createServiceClient();
  type ActivePerFirm = {
    firmName: string;
    firmAccent: string | null;
    documents: Awaited<ReturnType<typeof loadActiveFirmAssets>>["documents"];
    meetings: Awaited<ReturnType<typeof loadActiveFirmAssets>>["meetings"];
    invoices: Awaited<ReturnType<typeof loadActiveFirmAssets>>["invoices"];
  };
  const fromYourFirm: ActivePerFirm[] = [];
  for (const eng of rows.filter((e) => e.status === "active")) {
    if (!eng.firm) continue;
    const assets = await loadActiveFirmAssets(adminClient, company.id, eng.id);
    fromYourFirm.push({
      firmName: eng.firm.name,
      firmAccent: eng.firm.accent_color,
      documents: assets.documents,
      meetings: assets.meetings,
      invoices: assets.invoices,
    });
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
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

        {fromYourFirm.map((f, idx) => (
          <FromYourFirmPanel
            key={idx}
            firmName={f.firmName}
            firmAccentColor={f.firmAccent}
            documents={f.documents}
            meetings={f.meetings}
            invoices={f.invoices}
          />
        ))}

        {/* Phase 9.5: subscribe to firm_documents/meetings/invoices
            for every active engagement on this company, refresh the
            server-rendered panels live. */}
        {activeEngagementIds.length > 0 ? (
          <FromYourFirmRealtime
            companyId={company.id}
            engagementIds={activeEngagementIds}
          />
        ) : null}
      </section>
    </main>
  );
}

type FirmAssetDocument = {
  id: string;
  kind: string;
  status: string;
  filename: string;
  created_at: string;
  signed_at: string | null;
};
type FirmAssetMeeting = {
  id: string;
  kind: string;
  starts_at: string;
  duration_minutes: number;
  status: string;
  meeting_url: string | null;
  agenda: string | null;
};
type FirmAssetInvoice = {
  id: string;
  invoice_number: string;
  total_cents: number;
  currency: string;
  status: string;
  due_at: string | null;
  stripe_hosted_invoice_url: string | null;
};
type FirmAssetsBundle = {
  documents: FirmAssetDocument[];
  meetings: FirmAssetMeeting[];
  invoices: FirmAssetInvoice[];
};

// Service-role read of the firm assets visible to this client.
// Filters keep us scoped:
//   - Documents/meetings/invoices live on engagements; we pass the
//     engagement_id to scope by row.
//   - Documents: only signed / awaiting_signature / sent_to_client /
//     filed (the client doesn't need to see firm-side drafts).
//   - Meetings: only future ones, or recent past (last 7 days).
//   - Invoices: only sent / viewed / paid (no drafts).
async function loadActiveFirmAssets(
  admin: ReturnType<typeof createServiceClient>,
  companyId: string,
  engagementId: string,
): Promise<FirmAssetsBundle> {
  const now = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [{ data: docs }, { data: meetings }, { data: invoices }] =
    await Promise.all([
      admin
        .from("firm_documents")
        .select("id, kind, status, filename, created_at, signed_at")
        .eq("company_id", companyId)
        .eq("engagement_id", engagementId)
        .in("status", [
          "ready_for_review",
          "awaiting_signature",
          "signed",
          "filed",
          "sent_to_client",
        ])
        .order("created_at", { ascending: false })
        .limit(10),
      admin
        .from("firm_meetings")
        .select(
          "id, kind, starts_at, duration_minutes, status, meeting_url, agenda",
        )
        .eq("company_id", companyId)
        .eq("engagement_id", engagementId)
        .neq("status", "cancelled")
        .gte("starts_at", sevenDaysAgo)
        .order("starts_at", { ascending: true })
        .limit(5),
      admin
        .from("firm_invoices")
        .select(
          "id, invoice_number, total_cents, currency, status, due_at, stripe_hosted_invoice_url",
        )
        .eq("company_id", companyId)
        .eq("engagement_id", engagementId)
        .in("status", ["sent", "viewed", "paid"])
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  void now; // future use: filter "upcoming" vs "completed" meetings
  return {
    documents: (docs ?? []) as FirmAssetDocument[],
    meetings: (meetings ?? []) as FirmAssetMeeting[],
    invoices: (invoices ?? []) as FirmAssetInvoice[],
  };
}
