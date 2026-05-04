// Master deduction reference types. Data lives in master.ts (generated from
// the IRS-sourced master_business_deduction_checklist_by_entity.xlsx).

export type MasterDeduction = {
  /** Stable IRS-style code, e.g. "M001" - primary key. */
  code: string;
  /** Top-level category, e.g. "Marketing, advertising, sales, and branding". */
  category: string;
  /** Specific deduction or expense type, e.g. "Google Ads". */
  name: string;
  /** Free-text applicability statement from the source workbook. */
  applicability: string;
  /** Best-fit business / industry hint. */
  industry: string;
  /** One-liner deductibility notes. */
  notes: string;
  /** IRS publication or topic URL. */
  source: string;
};

/** Entity types the company onboarding wizard supports. */
export type CompanyEntityType =
  | "sole_prop"
  | "single_llc"
  | "multi_llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "self_employed_1099"
  | "nonprofit"
  | "cooperative";
