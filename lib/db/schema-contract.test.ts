import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A PostgREST select naming a column that does not exist does not throw.
// It comes back `{ data: null, error: { code: "42703" } }`, and every
// money path in this repo destructures `data` and ignores `error`. The
// query therefore returns NOTHING, silently, and whatever guard was
// reading those rows is switched off with no trace at runtime.
//
// That is not hypothetical. lib/plaid/sync.ts selected
// `monthly_expenses.recurring_key`, a column only ever added to
// monthly_income, so its recurring-expense candidate list was always
// empty and EVERY subscription-like bank charge was written
// `recurrence: 'monthly'`. Each one then projected from its own month
// through December: a $50/mo subscription seen in January and February
// forecast $1,150 of deductions instead of $600.
//
// So: the tables the forecast is computed from are checked, statically,
// against the migrations that define them. This test needs no database.

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

/** The tables whose column drift changes a number on a tax return. */
const GUARDED_TABLES = [
  "monthly_expenses",
  "monthly_income",
  "bank_transactions",
  "account_transactions",
  "bank_imports",
] as const;

const SOURCE_DIRS = ["lib", "app"];
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * Replay every migration in filename order and return the columns each
 * guarded table ends up with. Handles the four shapes this repo uses:
 * create table, add column, drop column, rename column.
 */
function columnsFromMigrations(
  tables: readonly string[] = GUARDED_TABLES,
): Map<string, Set<string>> {
  const columns = new Map<string, Set<string>>(
    tables.map((t) => [t as string, new Set<string>()]),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    for (const table of tables) {
      const set = columns.get(table)!;

      const createRe = new RegExp(
        `create table (?:if not exists )?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`,
        "gi",
      );
      let create: RegExpExecArray | null;
      while ((create = createRe.exec(sql))) {
        for (const line of create[1].split("\n")) {
          const name = line.trim().match(/^([a-z_][a-z0-9_]*)\s+/i);
          if (!name) continue;
          if (/^(primary|unique|constraint|foreign|check|exclude|like)$/i.test(name[1])) {
            continue;
          }
          set.add(name[1]);
        }
      }

      const alterRe = new RegExp(
        `alter table (?:only )?(?:public\\.)?${table}([\\s\\S]*?);`,
        "gi",
      );
      let alter: RegExpExecArray | null;
      while ((alter = alterRe.exec(sql))) {
        const body = alter[1];
        for (const m of body.matchAll(
          /add column (?:if not exists )?([a-z_][a-z0-9_]*)/gi,
        )) {
          set.add(m[1]);
        }
        for (const m of body.matchAll(
          /drop column (?:if exists )?([a-z_][a-z0-9_]*)/gi,
        )) {
          set.delete(m[1]);
        }
        for (const m of body.matchAll(
          /rename column ([a-z_][a-z0-9_]*) to ([a-z_][a-z0-9_]*)/gi,
        )) {
          set.delete(m[1]);
          set.add(m[2]);
        }
      }
    }
  }
  return columns;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (SOURCE_EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

type SelectSite = { file: string; table: string; column: string };

/**
 * Every `.from("<guarded table>") … .select("<literal>")` in the app,
 * flattened to one entry per selected column.
 *
 * Deliberately conservative: only a plain double-quoted literal is read,
 * only when it is the first `.select(` after the `.from(`, and embedded
 * relation selects (`foo(bar, baz)`) and `*` are skipped. A shape this
 * cannot read is not reported as a failure, because a false accusation
 * here is worse than a miss.
 */
function selectSites(): SelectSite[] {
  const sites: SelectSite[] = [];
  const fromRe = new RegExp(
    `\\.from\\(\\s*"(${GUARDED_TABLES.join("|")})"\\s*\\)`,
    "g",
  );

  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(join(REPO_ROOT, dir))) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const src = readFileSync(file, "utf8");
      let from: RegExpExecArray | null;
      fromRe.lastIndex = 0;
      while ((from = fromRe.exec(src))) {
        const table = from[1];
        const rest = src.slice(from.index + from[0].length);
        const selectAt = rest.indexOf(".select(");
        if (selectAt === -1) continue;
        // Another .from() before the .select() means they are unrelated.
        const nextFrom = rest.indexOf(".from(");
        if (nextFrom !== -1 && nextFrom < selectAt) continue;
        const after = rest.slice(selectAt + ".select(".length);
        const literal = after.match(/^\s*"((?:[^"\\]|\\.)*)"/);
        if (!literal) continue;
        const list = literal[1];
        if (list.includes("*") || list.includes("(")) continue;
        for (const raw of list.split(",")) {
          const column = raw.trim();
          if (column) sites.push({ file, table, column });
        }
      }
    }
  }
  return sites;
}

describe("PostgREST select columns exist in the migrations", () => {
  const schema = columnsFromMigrations();

  it("derives a non-empty column set for every guarded table", () => {
    // Guards the guard: a regex that stopped matching would make every
    // assertion below vacuous.
    for (const table of GUARDED_TABLES) {
      expect(schema.get(table)!.size, table).toBeGreaterThan(5);
    }
  });

  it("finds the select sites it is meant to check", () => {
    expect(selectSites().length).toBeGreaterThan(10);
  });

  it("names no column the migrations do not define", () => {
    const unknown = selectSites()
      .filter((s) => !schema.get(s.table)!.has(s.column))
      .map((s) => `${s.file.slice(REPO_ROOT.length + 1)}: ${s.table}.${s.column}`);
    expect(unknown).toEqual([]);
  });
});

/**
 * The same 42703, on a WRITE instead of a read.
 *
 * The guard above checks SELECTs on the money tables. It could not see the
 * bug that took the mileage heartbeat off the air for a day, because that
 * one was an UPSERT, on a mileage table, of a payload object rather than a
 * string literal. Three misses in one, so the guard is widened here to the
 * shape that actually failed.
 *
 * app/api/mileage/heartbeat/route.ts builds ONE payload and writes it to
 * BOTH tables, status first:
 *
 *     .from("mileage_device_status").upsert(payload, ...)
 *     if (error) return 500        <- returns before the history append
 *
 * arm_interrupted_at, web_build and eight car_* columns were added to
 * mileage_device_heartbeats only. So the status upsert named ten columns
 * that did not exist, Postgres answered 42703, and every heartbeat from
 * every device on both platforms died at the first write. Nothing logged a
 * missing row, because the row was never attempted.
 *
 * Both tables are therefore asserted against the same payload: the two are
 * written from one object and must stay one shape.
 */
const HEARTBEAT_TABLES = [
  "mileage_device_status",
  "mileage_device_heartbeats",
] as const;

/** Keys of the `const payload = { ... }` literal in the heartbeat route. */
function heartbeatPayloadKeys(): string[] {
  const src = readFileSync(
    join(REPO_ROOT, "app", "api", "mileage", "heartbeat", "route.ts"),
    "utf8",
  );
  const start = src.indexOf("const payload = {");
  if (start === -1) throw new Error("heartbeat payload not found — test is stale");
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src
    .slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return [...body.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]);
}

describe("the heartbeat payload matches BOTH tables it is written to", () => {
  const schema = columnsFromMigrations(HEARTBEAT_TABLES);
  const keys = heartbeatPayloadKeys();

  it("derives a non-empty column set for both tables", () => {
    for (const t of HEARTBEAT_TABLES) {
      expect(schema.get(t)!.size, t).toBeGreaterThan(10);
    }
  });

  it("finds the payload keys it is meant to check", () => {
    expect(keys.length).toBeGreaterThan(20);
  });

  it("names no column either table is missing", () => {
    const missing: string[] = [];
    for (const t of HEARTBEAT_TABLES) {
      for (const k of keys) {
        if (!schema.get(t)!.has(k)) missing.push(`${t}.${k}`);
      }
    }
    expect(
      missing,
      "The heartbeat route upserts this payload into mileage_device_status " +
        "BEFORE appending history, and returns 500 on error. A column the " +
        "table lacks does not degrade the heartbeat, it deletes it: every " +
        "device, both platforms, silently.",
    ).toEqual([]);
  });
});
