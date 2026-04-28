"use client";

import { useState } from "react";

type Props = {
  companyId: string;
  taxYear: number;
  isManager: boolean;
  initial: {
    expectedRevenueCents: number | null;
    primaryIndustry: string | null;
    hasEmployees: boolean;
    employeeCount: number | null;
    hasVehicle: boolean;
    hasHomeOffice: boolean;
    homeOfficeSqft: number | null;
    homeTotalSqft: number | null;
    vehicleMethod: string | null;
    vehicleBusinessMiles: number | null;
    ein: string | null;
    legalName: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    zip: string | null;
    phone: string | null;
    businessEmail: string | null;
  };
  // The server action passed in from the page (a Server Action reference).
  action: (formData: FormData) => Promise<void>;
};

type Status = "idle" | "saving" | "saved" | "error";

export function BusinessProfileForm({
  companyId,
  taxYear,
  isManager,
  initial,
  action,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isManager || status === "saving") return;
    const fd = new FormData(e.currentTarget);
    setStatus("saving");
    setError(null);
    try {
      await action(fd);
      setStatus("saved");
      // revert to idle after a moment so the message is noticed but not sticky
      setTimeout(() => setStatus("idle"), 2400);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 grid gap-5">
      <input type="hidden" name="company_id" value={companyId} />
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
            initial.expectedRevenueCents != null
              ? (initial.expectedRevenueCents / 100).toFixed(0)
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
          defaultValue={initial.primaryIndustry ?? ""}
          placeholder="e.g. Photography, Software, Consulting"
        />
      </label>

      <div className="grid gap-3">
        <Toggle
          name="has_employees"
          label="Has W-2 employees"
          defaultChecked={initial.hasEmployees}
          disabled={!isManager}
        />
        <label className="grid gap-1.5 sm:max-w-xs">
          <span className="text-sm font-medium text-forest-800">
            Headcount (W-2 employees)
          </span>
          <input
            name="employee_count"
            type="number"
            min={0}
            step={1}
            className="input"
            disabled={!isManager}
            defaultValue={initial.employeeCount ?? 0}
          />
          <span className="text-xs text-ink-muted">
            Determines how many teammates you can invite. Adding more
            teammates than this number will prompt you to update it.
          </span>
        </label>
        <Toggle
          name="has_vehicle"
          label="Uses a vehicle for business"
          defaultChecked={initial.hasVehicle}
          disabled={!isManager}
        />
        <Toggle
          name="has_home_office"
          label="Has a dedicated home office"
          defaultChecked={initial.hasHomeOffice}
          disabled={!isManager}
        />
      </div>

      <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-forest-100 pt-5">
        <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
          Vehicle (if applicable)
        </legend>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-forest-800">Method</span>
          <select
            name="vehicle_method"
            className="input"
            disabled={!isManager}
            defaultValue={initial.vehicleMethod ?? ""}
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
            defaultValue={initial.vehicleBusinessMiles ?? ""}
          />
        </label>
      </fieldset>

      <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-forest-100 pt-5">
        <legend className="text-xs uppercase tracking-[0.2em] text-gold-700 px-2">
          For your tax preparer (optional)
        </legend>
        <p className="sm:col-span-2 text-xs text-ink-muted -mt-1 leading-relaxed">
          These show up on the year-end PDF you can hand to a CPA. All
          optional. EIN is your federal employer identification number if you
          have one; sole proprietors often use their SSN instead and can leave
          this blank.
        </p>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-forest-800">
            Legal business name
          </span>
          <input
            name="legal_name"
            type="text"
            className="input"
            disabled={!isManager}
            defaultValue={initial.legalName ?? ""}
            placeholder="e.g. Acme Photography LLC"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-forest-800">EIN</span>
          <input
            name="ein"
            type="text"
            inputMode="numeric"
            className="input"
            disabled={!isManager}
            defaultValue={initial.ein ?? ""}
            placeholder="12-3456789"
            maxLength={20}
          />
        </label>
        <label className="grid gap-1.5 sm:col-span-2">
          <span className="text-sm font-medium text-forest-800">
            Street address
          </span>
          <input
            name="address_line1"
            type="text"
            className="input"
            disabled={!isManager}
            defaultValue={initial.addressLine1 ?? ""}
            placeholder="1234 Main St"
          />
        </label>
        <label className="grid gap-1.5 sm:col-span-2">
          <span className="text-sm font-medium text-forest-800">
            Suite / unit (optional)
          </span>
          <input
            name="address_line2"
            type="text"
            className="input"
            disabled={!isManager}
            defaultValue={initial.addressLine2 ?? ""}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-forest-800">City</span>
          <input
            name="city"
            type="text"
            className="input"
            disabled={!isManager}
            defaultValue={initial.city ?? ""}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-forest-800">ZIP</span>
          <input
            name="zip"
            type="text"
            inputMode="numeric"
            className="input"
            disabled={!isManager}
            defaultValue={initial.zip ?? ""}
            maxLength={10}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-forest-800">Phone</span>
          <input
            name="phone"
            type="tel"
            className="input"
            disabled={!isManager}
            defaultValue={initial.phone ?? ""}
            placeholder="(555) 123-4567"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-forest-800">
            Business email
          </span>
          <input
            name="business_email"
            type="email"
            className="input"
            disabled={!isManager}
            defaultValue={initial.businessEmail ?? ""}
            placeholder="hello@yourbusiness.com"
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
            defaultValue={initial.homeOfficeSqft ?? ""}
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
            defaultValue={initial.homeTotalSqft ?? ""}
          />
        </label>
      </fieldset>

      {isManager ? (
        <div className="flex items-center gap-3 mt-2">
          <button
            type="submit"
            className="btn-primary w-full sm:w-auto"
            disabled={status === "saving"}
          >
            {status === "saving" ? "Saving..." : "Save profile"}
          </button>
          {status === "saved" ? (
            <span
              role="status"
              className="text-sm text-emerald-800 inline-flex items-center gap-1"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8 L7 12 L13 4" />
              </svg>
              Saved
            </span>
          ) : null}
          {status === "error" && error ? (
            <span role="alert" className="text-sm text-red-700">
              {error}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-ink-muted">
          Only managers can edit. Ask a manager to update.
        </p>
      )}
    </form>
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
