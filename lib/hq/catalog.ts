/**
 * The schema catalog, read from the migrations rather than from memory.
 *
 * Two parts of the Techno Optics fleet contract need to know which tables
 * carry tenant data, and both of them say the same thing about how to find
 * out. Section 8.1: "Do not build this as a hand-written list of tables. It
 * goes stale on the next migration. Build it from the schema." Section 8.7
 * step 5: enumerate tables from the schema catalog "so a table added next
 * quarter fails this test instead of silently escaping the purge."
 *
 * So this module derives the set. It is used by the boundary guard today and
 * will be used by purge_tenant when that endpoint is unblocked.
 *
 * WHY THERE IS A SNAPSHOT AS WELL AS A PARSER
 *
 * docs/migration-history-state.md records that this project was migrated for
 * months through the Supabase SQL editor: 122 rows exist in schema_migrations
 * with no local file. The migration directory is therefore an INCOMPLETE
 * description of the database. A catalog derived only from files would miss
 * tables that exist in production, and a purge built on it would silently
 * skip them, which is the exact failure 8.7 step 5 exists to prevent.
 *
 * TENANT_TABLES below is a snapshot taken from the live database catalog
 * (pg_class / pg_attribute on project enisnjjbxqaliydepacc). The parser's job
 * is not to replace it but to CHECK it: a migration that adds a table with a
 * company_id column and does not update the snapshot fails the guard. That
 * gives the "added next quarter fails the test" property without pretending
 * the files are complete.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

/**
 * Public tables carrying a `company_id` column, from the database catalog on
 * 2026-08-17. Regenerate with:
 *
 *   select c.relname from pg_class c
 *     join pg_namespace n on n.oid = c.relnamespace
 *    where n.nspname = 'public' and c.relkind = 'r'
 *      and exists (select 1 from pg_attribute a
 *                   where a.attrelid = c.oid and a.attname = 'company_id'
 *                     and a.attnum > 0 and not a.attisdropped)
 *    order by 1;
 *
 * `relkind = 'r'` matters: expense_booking_orphans has a company_id column
 * and is a VIEW, so it holds no rows of its own and must not be treated as a
 * purge target or given a policy.
 */
export const TENANT_TABLES: readonly string[] = [
  "admin_cross_tenant_access_log",
  "bank_connections",
  "bank_import_duplicates",
  "bank_imports",
  "bank_transactions",
  "bella_conversations",
  "business_profiles",
  "categorization_rules",
  "chat_conversations",
  "company_activity",
  "company_members",
  "company_state_nexus",
  "departments",
  "firm_activity_log",
  "firm_documents",
  "firm_efilings",
  "firm_engagements",
  "firm_invoice_templates",
  "firm_invoices",
  "firm_meetings",
  "goals",
  "invitations",
  "mileage_device_heartbeats",
  "mileage_device_status",
  "mileage_learned_places",
  "mileage_places",
  "mileage_points_raw",
  "mileage_render_refusals",
  "mileage_tracker_alerts",
  "mileage_trips",
  "monthly_expenses",
  "monthly_income",
  "prior_year_documents",
  "reminders",
  "sales_tax_records",
  "team_messages",
];

/**
 * Tables with no company_id of their own that are still reachable from a
 * tenant by following foreign keys to fixpoint. Section 8.1 calls these out
 * by name ("join tables, tables with a nullable tenant reference, tables that
 * reference a user rather than a tenant") because they are what a purge
 * leaves behind. Same source and same regeneration query as above, wrapped in
 * a recursive CTE over pg_constraint.
 *
 * These are NOT policy targets. Each one's own read policy resolves through a
 * parent that carries the barrier; the analysis of which are covered that way
 * and which are not is in docs/design/fleet-integration.md.
 */
export const TENANT_REACHABLE_TABLES: readonly string[] = [
  "account_transaction_suggestions",
  "account_transactions",
  "audit_cases",
  "audit_documents",
  "audit_notes",
  "bank_accounts",
  "bank_connection_secrets",
  "bella_messages",
  "chat_attachments",
  "chat_conversation_members",
  "chat_conversation_reads",
  "firm_client_outreach",
  "firm_document_comments",
  "firm_document_versions",
  "firm_messages",
  "firm_threads",
  "firm_w9_forms",
  "mileage_points",
];

/** Strip `--` line comments. A guard that matches a comment is not a guard. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** Every migration's SQL, in filename order, with comments stripped. */
export function migrationSql(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));
}

const CREATE_TABLE_RE =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\);/gi;
const ALTER_TABLE_RE =
  /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi;

/** Column names a create-table body declares, skipping table constraints. */
function columnsInCreateBody(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const name = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/i);
    if (!name) continue;
    if (
      /^(primary|unique|constraint|foreign|check|exclude|like)$/i.test(name[1])
    ) {
      continue;
    }
    out.push(name[1]);
  }
  return out;
}

/**
 * Replay every migration and return the column set each table ends up with.
 *
 * Same four DDL shapes lib/db/schema-contract.test.ts handles, generalised
 * from a fixed table list to every table the migrations mention. Views are
 * not matched, because `create view` is a different statement.
 */
export function columnsByTable(): Map<string, Set<string>> {
  const columns = new Map<string, Set<string>>();
  const ensure = (t: string) => {
    let set = columns.get(t);
    if (!set) {
      set = new Set<string>();
      columns.set(t, set);
    }
    return set;
  };

  for (const { sql } of migrationSql()) {
    for (const m of sql.matchAll(CREATE_TABLE_RE)) {
      const set = ensure(m[1]);
      for (const c of columnsInCreateBody(m[2])) set.add(c);
    }
    for (const m of sql.matchAll(ALTER_TABLE_RE)) {
      const set = ensure(m[1]);
      const body = m[2];
      for (const a of body.matchAll(
        /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
      )) {
        set.add(a[1]);
      }
      for (const d of body.matchAll(
        /drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
      )) {
        set.delete(d[1]);
      }
      for (const r of body.matchAll(
        /rename\s+column\s+([a-z_][a-z0-9_]*)\s+to\s+([a-z_][a-z0-9_]*)/gi,
      )) {
        set.delete(r[1]);
        set.add(r[2]);
      }
    }
  }
  return columns;
}

/** Tables the migration files declare with a `company_id` column. */
export function companyScopedTablesFromMigrations(): string[] {
  const out: string[] = [];
  for (const [table, cols] of columnsByTable()) {
    if (cols.has("company_id")) out.push(table);
  }
  return out.sort();
}

/**
 * Tables the boundary migration puts the `hq_sandbox_barrier` policy on.
 *
 * Read from the SQL rather than assumed, so that deleting a table from the
 * migration's array is what makes the guard fail, not an edit to the guard.
 * Covers both shapes the migration uses: the `tenant_tables text[]` array in
 * the DO block, and the standalone `create policy hq_sandbox_barrier on
 * public.<t>` statements.
 */
export function barrieredTables(): string[] {
  const found = new Set<string>();
  for (const { sql } of migrationSql()) {
    for (const m of sql.matchAll(
      /create\s+policy\s+hq_sandbox_barrier\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi,
    )) {
      found.add(m[1]);
    }
    const arrayMatch = sql.match(
      /tenant_tables\s+text\[\]\s*:=\s*array\s*\[([\s\S]*?)\]/i,
    );
    if (arrayMatch) {
      for (const q of arrayMatch[1].matchAll(/'([a-z_][a-z0-9_]*)'/g)) {
        found.add(q[1]);
      }
    }
  }
  return [...found].sort();
}
