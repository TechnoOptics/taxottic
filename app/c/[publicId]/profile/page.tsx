import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { BusinessProfileForm } from "@/components/BusinessProfileForm";
import { saveBusinessProfile } from "./actions";

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
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          {company.public_id} - Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Business profile
        </h1>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="profile" />
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
              ein: bp?.ein ?? null,
              legalName: bp?.legal_name ?? null,
              addressLine1: bp?.address_line1 ?? null,
              addressLine2: bp?.address_line2 ?? null,
              city: bp?.city ?? null,
              zip: bp?.zip ?? null,
              phone: bp?.phone ?? null,
              businessEmail: bp?.business_email ?? null,
            }}
            action={saveBusinessProfile}
          />
        </div>
      </section>
    </main>
  );
}
