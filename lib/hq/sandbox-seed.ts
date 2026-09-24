/**
 * The synthetic fixture a sandbox tenant opens onto.
 *
 * Fleet contract section 6.4, and the README's product note for Taxottic,
 * which is the sharper of the two:
 *
 *   "Multi-client books for firms means real taxpayer data. Section 6.1 and
 *    section 6.4 together mean no sandbox seed may be derived from any real
 *    return, masked, anonymized, sampled, or otherwise. Seed data is written
 *    by your team, checked in, and identical for every prospect."
 *
 * So: a literal in a source file. Not a database read, not a copy of a real
 * company with the names changed, not a sample. Anonymisation is not a
 * defence here - re-identification is a research field, and the requirement
 * is that no real client's data enters a sandbox at all, not that it enters
 * disguised.
 *
 * The numbers below are invented to read as a plausible single-owner
 * cabinetry business: seasonal revenue, a materials-heavy expense mix, and a
 * handful of local drives. Nothing is drawn from any Taxottic account.
 *
 * NO CALLER YET. provision_user is what applies this, and provision_user is
 * blocked on open question 1 (which call creates the sandbox tenant) and
 * question 10 (the role value the Hub sends). See
 * docs/design/fleet-integration.md. The fixture is checked in ahead of the
 * endpoint because the contract's phase 1 asks for it there, and because
 * sandbox-seed.test.ts can hold it to the schema in the meantime, which is
 * what stops it going stale before it is ever used.
 */

/** Column-for-column shapes, so the seed cannot name a column that is gone. */
export type SeedCompany = {
  name: string;
  entity_type: string;
  state_code: string;
};

export type SeedMonthlyIncome = {
  tax_year: number;
  month: number;
  amount_cents: number;
  source: string;
  notes: string;
};

export type SeedMonthlyExpense = {
  tax_year: number;
  month: number;
  amount_cents: number;
  category_code: string;
  notes: string;
};

export type SeedMileageTrip = {
  started_at_offset_minutes: number;
  duration_minutes: number;
  distance_miles: number;
  classification: string;
  notes: string;
};

export type SandboxSeed = {
  company: SeedCompany;
  monthly_income: SeedMonthlyIncome[];
  monthly_expenses: SeedMonthlyExpense[];
  mileage_trips: SeedMileageTrip[];
};

/**
 * The tax year the fixture is written against. A literal, not a computed
 * `new Date().getFullYear()`: the contract requires the seed be identical for
 * every prospect, and a value that changes on 1 January is not identical.
 * Rolling it forward is a deliberate edit to this file.
 */
export const SEED_TAX_YEAR = 2026;

/**
 * Invented names. Section 6.4: "Do not take a real client's company name and
 * change a letter. Use plainly invented names that are still plausible enough
 * to read as a real workspace."
 */
export const SANDBOX_SEED: SandboxSeed = {
  company: {
    name: "Northgate Cabinetry LLC",
    entity_type: "llc",
    state_code: "OR",
  },

  monthly_income: [
    { tax_year: SEED_TAX_YEAR, month: 1, amount_cents: 1840000, source: "sales", notes: "Kitchen remodel, Maple Ridge" },
    { tax_year: SEED_TAX_YEAR, month: 2, amount_cents: 1215000, source: "sales", notes: "Two vanity units" },
    { tax_year: SEED_TAX_YEAR, month: 3, amount_cents: 2470000, source: "sales", notes: "Full kitchen, Alder Street" },
    { tax_year: SEED_TAX_YEAR, month: 4, amount_cents: 2905000, source: "sales", notes: "Built-in shelving, three units" },
    { tax_year: SEED_TAX_YEAR, month: 5, amount_cents: 3120000, source: "sales", notes: "Kitchen and utility room" },
    { tax_year: SEED_TAX_YEAR, month: 6, amount_cents: 2680000, source: "sales", notes: "Two bathroom fit-outs" },
  ],

  monthly_expenses: [
    { tax_year: SEED_TAX_YEAR, month: 1, amount_cents: 742000, category_code: "supplies", notes: "Hardwood stock" },
    { tax_year: SEED_TAX_YEAR, month: 1, amount_cents: 128000, category_code: "utilities", notes: "Workshop power" },
    { tax_year: SEED_TAX_YEAR, month: 2, amount_cents: 486000, category_code: "supplies", notes: "Hinges and runners" },
    { tax_year: SEED_TAX_YEAR, month: 2, amount_cents: 310000, category_code: "insurance", notes: "Liability, quarterly" },
    { tax_year: SEED_TAX_YEAR, month: 3, amount_cents: 918000, category_code: "supplies", notes: "Veneer and adhesive" },
    { tax_year: SEED_TAX_YEAR, month: 3, amount_cents: 205000, category_code: "repairs", notes: "Panel saw service" },
    { tax_year: SEED_TAX_YEAR, month: 4, amount_cents: 1104000, category_code: "supplies", notes: "Carcass sheet goods" },
    { tax_year: SEED_TAX_YEAR, month: 4, amount_cents: 168000, category_code: "software", notes: "Cabinet layout licence" },
    { tax_year: SEED_TAX_YEAR, month: 5, amount_cents: 1290000, category_code: "supplies", notes: "Solid surface tops" },
    { tax_year: SEED_TAX_YEAR, month: 5, amount_cents: 142000, category_code: "utilities", notes: "Workshop power" },
    { tax_year: SEED_TAX_YEAR, month: 6, amount_cents: 862000, category_code: "supplies", notes: "Door fronts" },
    { tax_year: SEED_TAX_YEAR, month: 6, amount_cents: 396000, category_code: "advertising", notes: "Local trade directory" },
  ],

  /**
   * Offsets rather than timestamps, so the fixture stays a constant. The
   * provisioning code turns them into wall-clock times relative to the moment
   * the sandbox is created, which is how the prospect sees recent drives
   * instead of drives from whenever this file was written.
   */
  mileage_trips: [
    { started_at_offset_minutes: -2880, duration_minutes: 34, distance_miles: 18.4, classification: "business", notes: "Site measure, Alder Street" },
    { started_at_offset_minutes: -2760, duration_minutes: 41, distance_miles: 21.7, classification: "business", notes: "Return from site measure" },
    { started_at_offset_minutes: -1440, duration_minutes: 22, distance_miles: 9.6, classification: "business", notes: "Hardware collection" },
    { started_at_offset_minutes: -1380, duration_minutes: 26, distance_miles: 11.2, classification: "personal", notes: "" },
    { started_at_offset_minutes: -420, duration_minutes: 58, distance_miles: 37.9, classification: "business", notes: "Delivery, Maple Ridge" },
  ],
};
