/**
 * CompanyNav has been deprecated as of the May 25 2026 IA restructure.
 *
 * The 5-tab strip (Forecast / Money in / Money out / Deductions /
 * Setup / Talk) was replaced by the company-aware LeftRail
 * (components/LeftRail.tsx). Every per-company surface now lives in
 * the rail's "[Company name] → Forecast / Income / Expenses / Mileage
 * / Import / Deductions / Chat / Settings" section, eliminating the
 * tabs-inside-the-page pattern that user feedback flagged as "tabs
 * within tabs."
 *
 * This component is intentionally left in place as a no-op so the
 * 20-odd callers don't have to be touched in one breath. A follow-up
 * pass will rip the imports out file-by-file. Until then, every
 * <CompanyNav publicId={...} active={...} /> renders nothing.
 *
 * Do NOT extend this component. Add new per-company nav entries to
 * LeftRail.COMPANY_ITEMS instead.
 */

type TabKey =
  | "forecast"
  | "money-in"
  | "money-out"
  | "deductions"
  | "setup"
  | "talk";

type LegacyKey =
  | "income"
  | "expenses"
  | "my-deductions"
  | "mileage"
  | "banks"
  | "sales-tax"
  | "import"
  | "profile"
  | "team"
  | "chat"
  | "preparer";

type CompanyNavProps = {
  publicId: string;
  active: TabKey | LegacyKey;
};

export function CompanyNav(_props: CompanyNavProps) {
  // Intentional no-op. See file header.
  return null;
}
