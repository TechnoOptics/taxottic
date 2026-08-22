/**
 * The sandbox boundary, asserted against the schema.
 *
 * Fleet contract section 6.8 names one test as the deliverable: a user
 * created via provision_user cannot read any row belonging to a production
 * tenant, run against the real mechanism. The real mechanism here is Postgres
 * row-level security, so the real-mechanism half of that test is a psql
 * script, supabase/tests/rls-hq-sandbox-isolation.sql, which needs a database.
 *
 * This file is the half that runs in CI with no database. Its job is
 * narrower and specific: prove that the boundary the psql script tests is
 * actually declared, and that it still covers every tenant table after a
 * migration nobody remembered to check. Section 8.7 step 5 asks for exactly
 * this shape - tables enumerated from the catalog, so a table added next
 * quarter fails a test instead of silently escaping.
 *
 * Every assertion reads comment-stripped SQL. This repository has shipped
 * five guards that matched a doc comment rather than code.
 */

import { describe, it, expect } from "vitest";
import {
  TENANT_TABLES,
  TENANT_REACHABLE_TABLES,
  barrieredTables,
  columnsByTable,
  companyScopedTablesFromMigrations,
  migrationSql,
  stripSqlComments,
} from "./catalog";

/** All migrations concatenated, comments already stripped. */
const ALL_SQL = migrationSql()
  .map((m) => m.sql)
  .join("\n");

describe("the catalog reader is not vacuous", () => {
  // Guards the guard. Every assertion below is a set comparison, and a set
  // comparison against an empty set passes silently. A regex that stopped
  // matching would turn this whole file green and mean nothing.
  it("parses a realistic number of tables and columns out of the migrations", () => {
    const tables = columnsByTable();
    expect(tables.size).toBeGreaterThan(80);
    // Table count alone is not enough: `alter table` alone populates the map,
    // so a dead create-table regex still yields 80+ entries with almost no
    // columns in them. Mutation-tested.
    const columns = [...tables.values()].reduce((n, s) => n + s.size, 0);
    expect(columns).toBeGreaterThan(600);
  });

  it("recovers the columns of a table it did not special-case", () => {
    const companies = columnsByTable().get("companies");
    expect(companies).toBeDefined();
    for (const known of ["id", "public_id", "name", "deleted_at"]) {
      expect([...companies!], known).toContain(known);
    }
  });

  it("strips comments before matching, so a doc comment cannot satisfy a guard", () => {
    expect(stripSqlComments("-- create policy hq_sandbox_barrier on public.x\n")).toBe(
      "\n",
    );
  });

  it("finds barrier policies at all", () => {
    expect(barrieredTables().length).toBeGreaterThan(30);
  });
});

describe("companies carries the sandbox flag the contract requires", () => {
  // Contract section 6.3, and the README checklist line:
  //   `sandbox boolean not null default false` on the tenant table.
  // The exact declaration is asserted, not just the column name, because
  // "nullable, defaulting to null" would make every egress decision in 6.5
  // read as "unknown" and there is no safe answer to that at 3am in a cron.
  it("declares sandbox boolean not null default false", () => {
    expect(
      /alter\s+table\s+public\.companies\s+add\s+column\s+if\s+not\s+exists\s+sandbox\s+boolean\s+not\s+null\s+default\s+false/i.test(
        ALL_SQL,
      ),
    ).toBe(true);
  });

  it("shows up in the parsed column set", () => {
    expect([...columnsByTable().get("companies")!]).toContain("sandbox");
  });
});

describe("the one predicate exists and is a predicate", () => {
  // Section 6.3 requires exactly one place that decides which tenant's rows a
  // request may touch, and that it be impossible to issue a data access that
  // skips it. In Postgres that is a security-definer predicate function
  // driving row-level security.
  it("defines hq_session_is_sandbox as a stable security definer function", () => {
    const m = ALL_SQL.match(
      /create\s+or\s+replace\s+function\s+public\.hq_session_is_sandbox\s*\(\s*\)([\s\S]{0,400}?)\$\$/i,
    );
    expect(m, "hq_session_is_sandbox is not declared").not.toBeNull();
    expect(/\bstable\b/i.test(m![1])).toBe(true);
    expect(/\bsecurity\s+definer\b/i.test(m![1])).toBe(true);
    expect(/set\s+search_path\s*=/i.test(m![1])).toBe(true);
  });

  it("defines hq_sandbox_company_ids as a stable security definer function", () => {
    const m = ALL_SQL.match(
      /create\s+or\s+replace\s+function\s+public\.hq_sandbox_company_ids\s*\(\s*\)([\s\S]{0,400}?)\$\$/i,
    );
    expect(m, "hq_sandbox_company_ids is not declared").not.toBeNull();
    expect(/\bstable\b/i.test(m![1])).toBe(true);
    expect(/\bsecurity\s+definer\b/i.test(m![1])).toBe(true);
    expect(/set\s+search_path\s*=/i.test(m![1])).toBe(true);
  });

  it("returns only sandbox ids from the set-returning predicate", () => {
    // An RLS predicate must be executable by every role the policy applies
    // to, including anon, and Supabase publishes public functions at
    // /rest/v1/rpc/. A predicate that returned "the ids in my realm" would
    // therefore hand every real company id to an unauthenticated caller.
    // The body must select sandbox rows, not their complement.
    const body = ALL_SQL.match(
      /create\s+or\s+replace\s+function\s+public\.hq_sandbox_company_ids[\s\S]*?as\s+\$\$([\s\S]*?)\$\$/i,
    );
    expect(body).not.toBeNull();
    expect(/where\s+c\.sandbox\s*;/i.test(body![1])).toBe(true);
    expect(/not\s+c?\.?sandbox/i.test(body![1])).toBe(false);
  });

  it("makes the barrier restrictive, so it can only ever narrow access", () => {
    // A permissive policy ORs with the others and would GRANT access. The
    // whole safety argument for adding this to 37 live tables is that a
    // restrictive policy cannot open anything.
    const barriers = [
      ...ALL_SQL.matchAll(/create\s+policy\s+hq_sandbox_barrier\b([\s\S]{0,200}?)using/gi),
    ];
    expect(barriers.length).toBeGreaterThan(0);
    for (const b of barriers) {
      expect(/\bas\s+restrictive\b/i.test(b[1])).toBe(true);
    }
    // The DO-block form builds its policy text with format(); assert the
    // template itself says restrictive too.
    expect(/as\s+restrictive\s+for\s+all\s+to\s+public/i.test(ALL_SQL)).toBe(true);
  });
});

describe("no tenant table escapes the barrier", () => {
  it("covers every table the snapshot lists", () => {
    const covered = new Set(barrieredTables());
    const missing = TENANT_TABLES.filter((t) => !covered.has(t));
    expect(
      missing,
      "these tables carry a company_id and no hq_sandbox_barrier policy, " +
        "so a sandbox tenant's rows are readable from a real session",
    ).toEqual([]);
  });

  it("covers the tenant table itself", () => {
    expect(barrieredTables()).toContain("companies");
  });

  it("keeps the snapshot equal to what the migrations declare", () => {
    // This is the assertion that survives everyone who wrote it. Add a table
    // with a company_id in a migration and this fails until the table is in
    // TENANT_TABLES, which in turn fails the coverage test above until the
    // barrier is added and, later, until purge_tenant covers it.
    expect(companyScopedTablesFromMigrations()).toEqual([...TENANT_TABLES]);
  });

  it("does not list a view as a tenant table", () => {
    // expense_booking_orphans has a company_id and is a view. Giving a view a
    // policy fails at apply time; treating it as a purge target would report
    // rows remaining that no delete can ever remove.
    expect(TENANT_TABLES).not.toContain("expense_booking_orphans");
  });

  it("names the reachable-but-not-scoped tables so the purge cannot forget them", () => {
    // Section 8.1's orphan-prone class. These have no company_id of their own
    // and are reachable only by following a foreign key, which is precisely
    // the class a hand-written purge list misses.
    expect(TENANT_REACHABLE_TABLES.length).toBeGreaterThan(10);
    for (const t of TENANT_REACHABLE_TABLES) {
      expect(TENANT_TABLES).not.toContain(t);
    }
    // Two of them resolve through a SECURITY DEFINER helper, which bypasses
    // the parent's RLS, so they carry the barrier directly. If that stops
    // being true the boundary has a hole nothing else would report.
    for (const t of ["chat_conversation_members", "chat_conversation_reads"]) {
      expect(barrieredTables(), `${t} lost its direct barrier`).toContain(t);
    }
  });
});
