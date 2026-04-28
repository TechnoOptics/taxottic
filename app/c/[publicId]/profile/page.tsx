import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
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
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-2xl mx-auto px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          {company.public_id} - Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Business profile
        </h1>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="profile" />
        </div>

        <div className="card mt-6 p-7">
          <p className="text-sm text-ink-soft">
            These details refine the forecast. Only managers can edit.
          </p>
          <form action={saveBusinessProfile} className="mt-6 grid gap-5">
            <input type="hidden" name="company_id" value={company.id} />
            <input type="hidden" name="tax_year" value={taxYear} />

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Expected annual revenue (USD)
              </span>
              <input
                name="expected_revenue"
                type="text"
                inputMode="decimal"
                className="input"
                disabled={!isManager}
                defaultValue={
                  bp?.expected_revenue_cents
                    ? (bp.expected_revenue_cents / 100).toFixed(0)
                    : ""
                }
                placeholder="$0"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Primary industry (optional)
              </span>
              <input
                name="primary_industry"
                type="text"
                className="input"
                disabled={!isManager}
                defaultValue={bp?.primary_industry ?? ""}
                placeholder="e.g. Photography, Software, Consulting"
              />
            </label>

            <div className="grid gap-3">
              <Toggle
                name="has_employees"
                label="Has W-2 employees"
                defaultChecked={bp?.has_employees ?? false}
                disabled={!isManager}
              />
              <Toggle
                name="has_vehicle"
                label="Uses a vehicle for business"
                defaultChecked={bp?.has_vehicle ?? false}
                disabled={!isManager}
              />
              <Toggle
                name="has_home_office"
                label="Has a dedicated home office"
                defaultChecked={bp?.has_home_office ?? false}
                disabled={!isManager}
              />
            </div>

            <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-forest-100 pt-5">
              <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
                Vehicle (if applicable)
              </legend>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-forest-800">
                  Method
                </span>
                <select
                  name="vehicle_method"
                  className="input"
                  disabled={!isManager}
                  defaultValue={bp?.vehicle_method ?? ""}
                >
                  <option value="">Not applicable</option>
                  <option value="standard">Standard mileage</option>
                  <option value="actual">Actual expenses</option>
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-forest-800">
                  Business miles (year-to-date)
                </span>
                <input
                  name="vehicle_business_miles"
                  type="number"
                  min={0}
                  className="input"
                  disabled={!isManager}
                  defaultValue={bp?.vehicle_business_miles ?? ""}
                />
              </label>
            </fieldset>

            <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-forest-100 pt-5">
              <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
                Home office (if applicable)
              </legend>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-forest-800">
                  Office sq ft
                </span>
                <input
                  name="home_office_sqft"
                  type="number"
                  min={0}
                  className="input"
                  disabled={!isManager}
                  defaultValue={bp?.home_office_sqft ?? ""}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-forest-800">
                  Total home sq ft
                </span>
                <input
                  name="home_total_sqft"
                  type="number"
                  min={0}
                  className="input"
                  disabled={!isManager}
                  defaultValue={bp?.home_total_sqft ?? ""}
                />
              </label>
            </fieldset>

            {isManager ? (
              <button className="btn-primary mt-2 w-full sm:w-auto">
                Save profile
              </button>
            ) : (
              <p className="text-xs text-ink-muted">
                Only managers can edit. Ask a manager to update.
              </p>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}

function Toggle({
  name,
  label,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
  disabled: boolean;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-1 size-4 accent-forest-800"
      />
      <span className="text-sm text-ink-soft">{label}</span>
    </label>
  );
}
