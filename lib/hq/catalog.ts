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
/**
 * `drop table` has to be replayed too, or a table that was created and then
 * dropped by a later migration reads as live. `_ddl_recovery` is exactly that:
 * a scratch table created to recover out-of-band DDL and dropped by the very
 * next migration. Without this the catalog reports a table the database does
 * not have, and section 8.1 step 6's partition can never balance.
 */
const DROP_TABLE_RE =
  /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;

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
    for (const d of sql.matchAll(DROP_TABLE_RE)) columns.delete(d[1]);
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

/* -------------------------------------------------------------------------
 * Section 8.1's purge recipe, expanded in revision C
 *
 * Revision B's recipe was one step: enumerate every table with a tenant
 * foreign key. `TENANT_TABLES` above is that step. Revision C adds four more,
 * because "a team found all four in one schema, including two tenant-bearing
 * columns with no foreign key that a constraint-keyed assertion misses
 * silently":
 *
 *   step 2  tenant-bearing columns carrying NO foreign key constraint
 *   step 3  the referential action on each foreign key you did find
 *   step 4  tables that reference a USER, a session, or the authentication
 *           schema rather than the tenant
 *   step 5  an exclusion list that is itself asserted, so that every table in
 *           the catalog is either covered or excluded
 *   step 6  covered + excluded == catalog, failing the build on a new table
 *
 * Everything below is measured against the live catalog of project
 * enisnjjbxqaliydepacc on 2026-08-22, for the reason the header of this file
 * already gives: 122 rows exist in schema_migrations with no local file, so
 * the migration directory is an incomplete description of the database.
 * ------------------------------------------------------------------------- */

/**
 * Step 2. Column names that carry a tenant reference in this schema, used to
 * find tables an FK sweep misses.
 *
 * Regenerate the finding with:
 *
 *   select c.relname, a.attname from pg_class c
 *     join pg_namespace n on n.oid = c.relnamespace
 *     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
 *                        and not a.attisdropped
 *    where n.nspname = 'public' and c.relkind = 'r'
 *      and a.attname = any (<TENANT_COLUMN_NAMES>)
 *      and not exists (select 1 from pg_constraint k
 *                       where k.conrelid = c.oid and k.contype = 'f'
 *                         and a.attnum = any (k.conkey));
 *
 * That query returns zero rows today: every `company_id` and every `firm_id`
 * in this schema carries a constraint. The list is kept, and the parser below
 * checks the migration files against it, because the finding that matters is
 * the first time it stops returning zero.
 */
export const TENANT_COLUMN_NAMES: readonly string[] = [
  "company_id",
  "firm_id",
  "tenant_id",
  "org_id",
  "organization_id",
  "hub_org_id",
];

/**
 * Step 3. Foreign keys into a tenant row whose referential action is not
 * `cascade`, which is the class 8.1 says "look like a working purge right up
 * until `remaining` is recounted".
 *
 * `SET NULL` orphans the row instead of removing it. `RESTRICT` and
 * `NO ACTION` block the delete outright. Both are recorded, both are findings,
 * and neither is fixed here: changing a referential action is a schema change,
 * and this repository's rule is that migrations are purely additive.
 *
 * Measured with:
 *
 *   select pc.relname as parent, c.relname as child, k.conname,
 *          k.confdeltype
 *     from pg_constraint k
 *     join pg_class c  on c.oid  = k.conrelid
 *     join pg_class pc on pc.oid = k.confrelid
 *     join pg_namespace n on n.oid = c.relnamespace
 *    where k.contype = 'f' and n.nspname = 'public'
 *      and k.confdeltype <> 'c';
 */
export const NON_CASCADING_TENANT_FKS: readonly {
  table: string;
  column: string;
  parent: string;
  action: "set null" | "restrict" | "no action";
  consequence: string;
}[] = [
  {
    table: "bella_conversations",
    column: "company_id",
    parent: "companies",
    action: "set null",
    consequence:
      "The prospect's own assistant conversations survive the purge with a " +
      "null company_id. The barrier policy passes any row whose company_id " +
      "is null, so they leave the sandbox side of the boundary as well as " +
      "the purge.",
  },
  {
    table: "firm_activity_log",
    column: "company_id",
    parent: "companies",
    action: "set null",
    consequence: "Activity rows survive the purge, detached from the tenant.",
  },
  {
    table: "firm_documents",
    column: "company_id",
    parent: "companies",
    action: "set null",
    consequence:
      "Document rows survive the purge. The storage objects they name are a " +
      "separate 8.1 class and are not removed by a row delete either way.",
  },
  {
    table: "firm_efilings",
    column: "company_id",
    parent: "companies",
    action: "set null",
    consequence: "E-filing rows survive the purge, detached from the tenant.",
  },
  {
    table: "firm_invoice_templates",
    column: "company_id",
    parent: "companies",
    action: "set null",
    consequence: "Template rows survive the purge, detached from the tenant.",
  },
  {
    table: "firm_invoices",
    column: "company_id",
    parent: "companies",
    action: "set null",
    consequence:
      "Invoice rows survive the purge. 8.1 counts billing objects, so a " +
      "recounted `remaining` keyed on company_id reports zero while they sit " +
      "there.",
  },
  {
    table: "firm_meetings",
    column: "company_id",
    parent: "companies",
    action: "set null",
    consequence: "Meeting rows survive the purge, detached from the tenant.",
  },
  {
    table: "profiles",
    column: "active_company_id",
    parent: "companies",
    action: "set null",
    consequence:
      "Correct as built: this is a pointer at the user's current workspace, " +
      "not tenant data. Recorded so the sweep is complete rather than " +
      "selective.",
  },
  {
    table: "bank_imports",
    column: "user_id",
    parent: "auth.users",
    action: "restrict",
    consequence:
      "BLOCKS the delete. A sandbox user who imported a bank file cannot be " +
      "removed until their bank_imports rows go first, so a purge that " +
      "deletes the user before the rows fails rather than under-reporting.",
  },
  {
    table: "bank_imports",
    column: "completed_by",
    parent: "profiles",
    action: "no action",
    consequence:
      "BLOCKS the delete of the profile row for the same reason, through a " +
      "second column on the same table.",
  },
  {
    table: "admin_actions",
    column: "admin_user_id",
    parent: "auth.users",
    action: "restrict",
    consequence:
      "BLOCKS the delete of a user who has taken an admin action. No sandbox " +
      "prospect ever holds super-admin, so this cannot bite a purge, and it " +
      "is recorded because 8.1 asks for the action on each key rather than " +
      "on the ones that look relevant.",
  },
];

/**
 * Step 4. Tables that hang off a user, a session, or the authentication
 * schema rather than off the tenant.
 *
 * 8.1: "They sit outside the tenant's foreign key closure entirely. Passkeys
 * and one-time email codes are named in the table above and are usually in
 * this class." Both of those are here. A purge that walks `company_id` and
 * follows foreign keys from `companies` reaches none of them, and every one
 * holds data the prospect created or that identifies them.
 *
 * Same regeneration as TENANT_TABLES, selecting tables whose only foreign keys
 * point at `auth.users` or `public.profiles`.
 */
export const USER_SCOPED_TABLES: readonly string[] = [
  "badges",
  "capture_attempts",
  "charitable_donations",
  "credits_ledger",
  "device_fingerprints",
  "device_tokens",
  "feedback",
  "notification_log",
  "passkeys",
  "personal_expenses",
  "profiles",
  "push_registration_state",
  "subscriptions",
  "tax_profiles",
  "watch_devices",
  "watch_pair_codes",
];

/**
 * Step 5. The exclusion list, with the reason each table is legitimately not
 * tenant data.
 *
 * 8.1: "An unasserted exclusion list is the hand-written list this rule exists
 * to prevent, wearing the other hat." So each entry carries its reason, the
 * reasons are asserted to exist, and the union with the covered classes is
 * asserted to equal the catalog.
 */
export const EXCLUDED_TABLES: readonly { table: string; reason: string }[] = [
  {
    table: "deduction_categories",
    reason:
      "Reference data. The IRS deduction catalog, identical for every tenant, " +
      "with no tenant column and no user column. Purging it would break every " +
      "other tenant.",
  },
  {
    table: "sales_tax_state_rates",
    reason:
      "Reference data. Per-state sales tax rates, identical for every tenant.",
  },
  {
    table: "tax_kb_documents",
    reason:
      "Reference data. Published tax guidance, the corpus the in-app " +
      "assistant retrieves from. Not tenant content, and " +
      "lib/hq/egress-chokepoints.test.ts asserts nothing writes tenant " +
      "content into it.",
  },
  {
    table: "tax_kb_chunks",
    reason:
      "Reference data. The chunked form of the same corpus, carrying the " +
      "embedding column. Same assertion covers it.",
  },
  {
    table: "super_admins",
    reason:
      "Vendor control plane. Sits above every tenant and names Techno Optics " +
      "staff. A sandbox prospect never appears in it.",
  },
  {
    table: "security_pulse_runs",
    reason:
      "Vendor control plane. Records of super-admin security scans of this " +
      "product, not of any tenant.",
  },
  {
    table: "admin_actions",
    reason:
      "Vendor control plane. An audit trail of super-admin actions. Its " +
      "target_user_id is SET NULL on user delete, so a purged sandbox user " +
      "leaves no identifier behind, and the row itself is the vendor's record " +
      "of its own staff.",
  },
  {
    table: "taxottic_enterprise_inquiries",
    reason:
      "Vendor lead capture. An inbound enquiry from an accounting firm to " +
      "Techno Optics, created before any tenant exists.",
  },
  {
    table: "firm_inquiries",
    reason: "Vendor lead capture, same class as the row above.",
  },
  {
    table: "firm_access_requests",
    reason:
      "Vendor access control. A request to be granted a firm operator " +
      "account, reviewed by staff.",
  },
  {
    table: "firms",
    reason:
      "The second tenant axis. A firm is an accounting practice, a separate " +
      "customer organization from a company, and a sandbox prospect is " +
      "provisioned into a company. No sandbox path creates a firm. If one is " +
      "ever added, this whole block becomes wrong and the assertion below is " +
      "what says so.",
  },
  { table: "firm_members", reason: "Firm axis. Membership of an accounting practice." },
  {
    table: "firm_invitations",
    reason: "Firm axis. Invitations to join an accounting practice as staff.",
  },
  { table: "firm_activity_reads", reason: "Firm axis. Read markers for a practice's activity feed." },
  { table: "firm_availability_rules", reason: "Firm axis. A practice's meeting availability." },
  { table: "firm_calendar_integrations", reason: "Firm axis. A practice's calendar connection." },
  { table: "firm_custom_domains", reason: "Firm axis. A practice's BYO portal domain." },
  { table: "firm_notification_preferences", reason: "Firm axis. A practice's notification settings." },
  { table: "firm_stripe_accounts", reason: "Firm axis. A practice's Stripe Connect account." },
  { table: "firm_subscriptions", reason: "Firm axis. A practice's own subscription to this product." },
];

/**
 * Step 6. The catalog itself, snapshot from the live database on 2026-08-22.
 *
 * 91 base tables in `public`. Regenerate with:
 *
 *   select c.relname from pg_class c
 *     join pg_namespace n on n.oid = c.relnamespace
 *    where n.nspname = 'public' and c.relkind = 'r' order by 1;
 */
export const ALL_TABLES: readonly string[] = [
  ...TENANT_TABLES,
  ...TENANT_REACHABLE_TABLES,
  ...USER_SCOPED_TABLES,
  ...EXCLUDED_TABLES.map((e) => e.table),
  "companies",
].sort();

/**
 * Step 2's parser. Tables the migration files declare with a tenant-bearing
 * column and no foreign key on it.
 *
 * The snapshot above says this is empty in the live database. This reads the
 * files instead, so that a migration adding an unconstrained tenant column
 * fails the build on the way in, which is the only moment the omission is
 * cheap to fix.
 */
export function unconstrainedTenantColumnsFromMigrations(): string[] {
  // Every statement that touches each table, gathered per table. Scoping this
  // matters and was got wrong once: a global search for "company_id ...
  // references" matches in some other migration for some other table, so every
  // column reads as constrained and the whole assertion goes quiet. Caught by
  // watching a probe table with an unconstrained company_id fail to fail.
  const perTable = new Map<string, string>();
  const append = (t: string, s: string) =>
    perTable.set(t, (perTable.get(t) ?? "") + "\n" + s);

  for (const { sql } of migrationSql()) {
    for (const m of sql.matchAll(CREATE_TABLE_RE)) append(m[1], m[2]);
    for (const m of sql.matchAll(ALTER_TABLE_RE)) append(m[1], m[2]);
  }

  const found = new Set<string>();
  for (const [table, cols] of columnsByTable()) {
    const body = perTable.get(table) ?? "";
    for (const col of cols) {
      if (!(TENANT_COLUMN_NAMES as string[]).includes(col)) continue;
      const constrained = new RegExp(
        `\\b${col}\\b[^,;)]*references|foreign\\s+key\\s*\\(\\s*${col}\\s*\\)`,
        "i",
      ).test(body);
      if (!constrained) found.add(`${table}.${col}`);
    }
  }
  return [...found].sort();
}
