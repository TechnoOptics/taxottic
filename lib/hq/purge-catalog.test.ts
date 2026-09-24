/**
 * The purge catalog, to section 8.1's recipe as expanded in revision C.
 *
 * Revision B's recipe was one step and `lib/hq/catalog.ts` was built to it:
 * enumerate every table with a tenant foreign key. Revision C adds four more,
 * on the evidence of a team that found all four in one schema, "including two
 * tenant-bearing columns with no foreign key that a constraint-keyed assertion
 * misses silently".
 *
 * This file asserts the expanded recipe. It does not implement `purge_tenant`,
 * which is blocked on open question 1 and has no endpoint; it holds the catalog
 * the purge will be built from, so that the catalog is correct before there is
 * anything to purge. Section 8.1 is explicit that this is the right order:
 * "Do not build this as a hand-written list of tables. It goes stale on the
 * next migration. Build it from the schema."
 *
 * WHAT WAS FOUND, PER STEP
 *
 *   step 2  ZERO unconstrained tenant columns. Every company_id and firm_id in
 *           this schema carries a foreign key. The named trap is absent here,
 *           and the parser below is what makes that a measurement rather than
 *           a claim about today.
 *   step 3  ELEVEN foreign keys into a tenant or a user that do not cascade.
 *           Seven of them are `company_id ... on delete set null`, which
 *           orphans the row rather than removing it, and three block the
 *           delete outright. This is the class 8.1 says "look like a working
 *           purge right up until `remaining` is recounted".
 *   step 4  SIXTEEN tables hanging off a user rather than a tenant, including
 *           `passkeys`, which 8.1 names by hand.
 *   step 5  TWENTY tables excluded, each with a reason.
 *   step 6  36 + 18 + 16 + 20 + companies = 91, which is what the catalog
 *           reports.
 */

import { describe, it, expect } from "vitest";
import {
  ALL_TABLES,
  EXCLUDED_TABLES,
  NON_CASCADING_TENANT_FKS,
  TENANT_COLUMN_NAMES,
  TENANT_REACHABLE_TABLES,
  TENANT_TABLES,
  USER_SCOPED_TABLES,
  columnsByTable,
  unconstrainedTenantColumnsFromMigrations,
} from "./catalog";

/** The catalog snapshot: 91 base tables in `public` on 2026-08-22. */
const CATALOG_SIZE = 91;

describe("step 2: tenant columns carrying no foreign key", () => {
  it("names the columns that count as a tenant reference in this schema", () => {
    // Guards the guard. An empty name list makes the parser return nothing and
    // the assertion below vacuous, which is the exact silence 8.1 warns about.
    expect(TENANT_COLUMN_NAMES).toContain("company_id");
    expect(TENANT_COLUMN_NAMES).toContain("firm_id");
    expect(TENANT_COLUMN_NAMES.length).toBeGreaterThan(4);
  });

  it("sees the tenant columns that do exist", () => {
    // Second half of guarding the guard: the parser must be reading a schema
    // in which these columns are present, or its silence means nothing.
    const withCompanyId = [...columnsByTable().entries()].filter(([, cols]) =>
      cols.has("company_id"),
    );
    expect(withCompanyId.length).toBeGreaterThan(25);
  });

  it("finds none", () => {
    expect(
      unconstrainedTenantColumnsFromMigrations(),
      "a migration declared a tenant-bearing column with no foreign key. " +
        "Section 8.1 step 2: an assertion keyed on constraints misses those in " +
        "silence, and one team found two, one of which held identity " +
        "verification state. Add the constraint, or add the table to the purge " +
        "catalog by column name.",
    ).toEqual([]);
  });
});

describe("step 3: referential actions that break a purge", () => {
  it("records every non-cascading key with its consequence", () => {
    expect(NON_CASCADING_TENANT_FKS.length).toBeGreaterThan(8);
    for (const fk of NON_CASCADING_TENANT_FKS) {
      expect(
        fk.consequence.length,
        `${fk.table}.${fk.column}: no consequence stated`,
      ).toBeGreaterThan(40);
    }
  });

  it("keeps the seven orphaning company keys on the record", () => {
    /**
     * These are the finding. `on delete set null` on `company_id` means
     * deleting the sandbox tenant row leaves the child rows in place with a
     * null tenant, and a `remaining` recounted by `company_id` reports zero
     * over rows that are still there. `bella_conversations` is the sharpest
     * case: it holds the prospect's own assistant transcripts, and the barrier
     * policy passes any row whose company_id is null, so an orphaned row is
     * outside the sandbox side of the boundary as well as outside the purge.
     *
     * Not fixed here. Changing a referential action is a schema change, and
     * this repository's migrations are purely additive. It is reported.
     */
    const orphaning = NON_CASCADING_TENANT_FKS.filter(
      (f) => f.action === "set null" && f.parent === "companies" && f.column === "company_id",
    ).map((f) => f.table);
    expect(orphaning.sort()).toEqual([
      "bella_conversations",
      "firm_activity_log",
      "firm_documents",
      "firm_efilings",
      "firm_invoice_templates",
      "firm_invoices",
      "firm_meetings",
    ]);
  });

  it("keeps the three blocking keys on the record", () => {
    // `restrict` and `no action` fail the delete rather than under-report it,
    // which is the better of the two failures and still a failure. A purge
    // built without knowing about these returns a 500 on its first real run.
    const blocking = NON_CASCADING_TENANT_FKS.filter(
      (f) => f.action === "restrict" || f.action === "no action",
    ).map((f) => `${f.table}.${f.column}`);
    expect(blocking.sort()).toEqual([
      "admin_actions.admin_user_id",
      "bank_imports.completed_by",
      "bank_imports.user_id",
    ]);
  });
});

describe("step 4: tables that reference a user rather than a tenant", () => {
  it("includes the classes 8.1 names by hand", () => {
    // 8.1's own table names passkeys and one-time email codes as usually being
    // in this class. Both are here, along with the push tokens and the device
    // fingerprints, which carry the prospect's device identity.
    for (const named of ["passkeys", "device_tokens", "subscriptions", "profiles"]) {
      expect(USER_SCOPED_TABLES, `${named} missing from the user-scoped class`).toContain(
        named,
      );
    }
  });

  it("holds none of them twice", () => {
    // A table in two classes would be counted twice by step 6 and would hide a
    // table that is in none.
    const tenant = new Set([...TENANT_TABLES, ...TENANT_REACHABLE_TABLES, "companies"]);
    const overlap = USER_SCOPED_TABLES.filter((t) => tenant.has(t));
    expect(overlap, "a table is in both the tenant closure and the user class").toEqual(
      [],
    );
  });
});

describe("step 5: the exclusion list is itself asserted", () => {
  it("gives a reason for every exclusion", () => {
    // 8.1: "An unasserted exclusion list is the hand-written list this rule
    // exists to prevent, wearing the other hat."
    for (const e of EXCLUDED_TABLES) {
      expect(e.reason.length, `${e.table}: excluded with no reason`).toBeGreaterThan(
        40,
      );
    }
  });

  it("excludes nothing that carries a tenant column", () => {
    // The one way this list becomes dangerous: excluding a table that does
    // hold tenant data. Checked against the parsed migrations rather than
    // against the reason text.
    const columns = columnsByTable();
    const wrong = EXCLUDED_TABLES.filter((e) => columns.get(e.table)?.has("company_id"))
      .map((e) => e.table);
    expect(
      wrong,
      "a table carrying company_id is on the exclusion list. It is tenant data " +
        "and a purge has to reach it.",
    ).toEqual([]);
  });

  it("holds no table twice", () => {
    const seen = EXCLUDED_TABLES.map((e) => e.table);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("step 6: covered plus excluded equals the catalog", () => {
  it("partitions every table in the database into exactly one class", () => {
    /**
     * The assertion 8.1 step 6 asks for, stated as a partition rather than as
     * a subset check, because "a new table is neither until somebody decides
     * which" and a subset check lets a new table be neither in silence.
     *
     * The catalog side of this is a snapshot, for the reason recorded at the
     * top of catalog.ts: 122 migrations exist only in the database, so the
     * files are an incomplete description of it. Regenerate it with the query
     * in the ALL_TABLES comment and re-run.
     */
    const classes = [
      ...TENANT_TABLES,
      ...TENANT_REACHABLE_TABLES,
      ...USER_SCOPED_TABLES,
      ...EXCLUDED_TABLES.map((e) => e.table),
      "companies",
    ];
    expect(new Set(classes).size, "a table appears in two classes").toBe(
      classes.length,
    );
    expect(
      classes.length,
      "the catalog snapshot is 91 base tables in public on 2026-08-22. If a " +
        "migration added one, put it in a class and raise this number in the " +
        "same commit. Section 8.1 step 6: fail the build when a new table " +
        "appears in neither.",
    ).toBe(CATALOG_SIZE);
    expect([...classes].sort()).toEqual([...ALL_TABLES]);
  });

  it("finds every table the migrations declare in some class", () => {
    /**
     * The other direction, and the one that catches a table added after the
     * snapshot was taken. The migration files are incomplete, so this cannot
     * prove the partition is total; it can prove that nothing declared in a
     * file is missing from it, which is the half a CI run can own without a
     * database.
     *
     * Views are excluded: `columnsByTable()` only matches `create table`, and
     * `expense_booking_orphans` is a view that carries a company_id and holds
     * no rows, which boundary.test.ts already asserts separately.
     */
    const declared = [...columnsByTable().keys()];
    const known = new Set(ALL_TABLES);
    const missing = declared.filter((t) => !known.has(t)).sort();
    expect(
      missing,
      "a migration declares a table that is in no purge class. Decide whether " +
        "it is tenant data, reachable from a tenant, hung off a user, or " +
        "legitimately excluded, and say so in lib/hq/catalog.ts.",
    ).toEqual([]);
  });
});
