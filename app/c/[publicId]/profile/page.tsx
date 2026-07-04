import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { BusinessProfileForm } from "@/components/BusinessProfileForm";
import { CompanyLogoUploader } from "@/components/CompanyLogoUploader";
import { decryptField } from "@/lib/crypto/field-encryption";
import {
  saveBusinessProfile,
  setCompanyLogoUrl,
  clearCompanyLogo,
} from "./actions";

type Params = Promise<{ publicId: string }>;

export default async function ProfilePage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company, isManager } = await loadCompanyByPublicId(
    publicId,
  );
  const taxYear = new Date().getUTCFullYear();

  const { data: bp } = await supabase
    .from("business_profiles")
    .select("*")
    .eq("company_id", company.id)
    .eq("tax_year", taxYear)
    .maybeSingle();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.name} <span className="text-gold-700">·</span>{" "}
          Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Business profile
        </h1>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="profile" />
        </div>

        {/* Logo: shows up here, on the dashboard, and on the printable
            year-end report. Sits above the rest of the form so managers
            see it as the first edit. */}
        <div className="card mt-6 p-6 sm:p-7">
          <CompanyLogoUploader
            companyId={company.id}
            companyPublicId={company.public_id}
            companyName={company.name}
            initialLogoUrl={company.logo_url}
            isManager={isManager}
            setLogoAction={setCompanyLogoUrl}
            clearLogoAction={clearCompanyLogo}
          />
        </div>

        <div className="card mt-6 p-6 sm:p-7">
          <p className="text-sm text-ink-soft">
            These details refine the forecast. Only managers can edit.
          </p>
          <BusinessProfileForm
            companyId={company.id}
            taxYear={taxYear}
            isManager={isManager}
            initial={{
              expectedRevenueCents: bp?.expected_revenue_cents ?? null,
              primaryIndustry: bp?.primary_industry ?? null,
              hasEmployees: bp?.has_employees ?? false,
              employeeCount: bp?.employee_count ?? null,
              hasVehicle: bp?.has_vehicle ?? false,
              hasHomeOffice: bp?.has_home_office ?? false,
              homeOfficeSqft: bp?.home_office_sqft ?? null,
              homeTotalSqft: bp?.home_total_sqft ?? null,
              vehicleMethod: bp?.vehicle_method ?? null,
              vehicleBusinessMiles: bp?.vehicle_business_miles ?? null,
              ein: decryptField(bp?.ein) ?? null,
              legalName: bp?.legal_name ?? null,
              addressLine1: bp?.address_line1 ?? null,
              addressLine2: bp?.address_line2 ?? null,
              city: bp?.city ?? null,
              zip: bp?.zip ?? null,
              phone: bp?.phone ?? null,
              businessEmail: bp?.business_email ?? null,
              receiptRequiredAboveCents: company.receipt_required_above_cents,
            }}
            action={saveBusinessProfile}
          />
        </div>
      </section>
    </main>
  );
}
