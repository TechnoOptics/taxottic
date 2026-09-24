/**
 * No table may carry two indexes that are the same index.
 *
 * WHY THIS EXISTS. mileage_points_raw carried both
 * `mileage_points_raw_identity_uq` and `mileage_points_raw_window_idx`
 * on the identical column list (driver_user_id, company_id,
 * captured_at), neither partial. A btree serves a query by its leading
 * columns, so the second could not answer a single question the first
 * could not. It cost 10 MB and was maintained by every insert and
 * update on the hottest write path in the product: 320,000 write
 * operations against a duplicate that bought nothing.
 *
 * Nobody did anything wrong to create it. The two came from different
 * migrations months apart, each reasonable on its own, and no reader
 * ever held both in view at once. That is precisely the class of
 * mistake a machine should catch, because catching it requires
 * comparing two files nobody has a reason to open together.
 *
 * WHAT COUNTS AS REDUNDANT HERE. Same table, same ordered column list,
 * same partial predicate (or both non-partial). That is deliberately
 * strict rather than clever: a prefix-redundancy check, where
 * (a) is subsumed by (a, b), is a real optimisation but it is a
 * judgement call, and a partial index on the same columns is a
 * different index serving a different query. `pending_idx` on this
 * same table has these three columns plus `where consumed_at is null`,
 * is a third of the size, and is genuinely useful, so a looser rule
 * would fire on it and be switched off within a month.
 *
 * Filesystem-only, like lib/db/schema-contract.test.ts. It replays the
 * migrations rather than reading a live database, so it runs in CI
 * with no credentials.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

type IndexDef = {
  name: string;
  table: string;
  columns: string;
  predicate: string | null;
  file: string;
};

/**
 * Strip SQL comments before parsing.
 *
 * Load-bearing, and not theoretical. The migration that removed the
 * duplicate documents both index names and both column lists in its
 * header comment, because an unexplained `drop index` is worse than no
 * comment at all. This repository has already shipped five guards that
 * matched their own explanatory prose and therefore asserted nothing.
 */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

/** Normalise a column list so formatting differences do not hide a match. */
function normaliseColumns(raw: string): string {
  return raw
    .split(",")
    .map((c) => c.trim().toLowerCase().replace(/\s+/g, " "))
    .join(",");
}

/**
 * The indexes Postgres creates on your behalf, which appear in no
 * `create index` statement anywhere.
 *
 * WHY THIS FUNCTION EXISTS, AND WHY IT WAS MISSING. The first version
 * of this guard compared only `create index` statements. It shipped
 * green while production held two real duplicates, because in both
 * cases the index being shadowed was created by a CONSTRAINT rather
 * than by a statement:
 *
 *   account_transactions.external_transaction_id text unique
 *   firm_w9_forms.request_token text not null unique
 *
 * Postgres backs each of those with an implicit unique index named
 * <table>_<column>_key, and a later migration then added a plain index
 * on the same single column. Two indexes, one redundant, and a guard
 * that could not see either half of the pair.
 *
 * That is the same failure this file was written to prevent, committed
 * by the file itself. A guard blind to a whole class of the thing it
 * guards reads as coverage and is not, which is worse than no guard,
 * so the blindness is removed here rather than documented.
 *
 * Column-level `unique`, table-level `unique (a, b)`, `primary key`
 * in both forms, and `alter table ... add constraint ... unique (...)`
 * all produce a real index and are all parsed.
 */
function impliedIndexes(sql: string, file: string): IndexDef[] {
  const out: IndexDef[] = [];

  const createTableRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\);/gi;

  for (const table of sql.matchAll(createTableRe)) {
    const name = table[1].toLowerCase();
    const body = table[2];

    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim().replace(/,$/, "");
      if (!line) continue;

      // Table-level: `unique (a, b)` or `primary key (a, b)`.
      const tableLevel = line.match(
        /^(?:constraint\s+[a-z0-9_]+\s+)?(unique|primary\s+key)\s*\(([^)]+)\)/i,
      );
      if (tableLevel) {
        out.push({
          name: `${name}_implied_${normaliseColumns(tableLevel[2]).replace(/,/g, "_")}`,
          table: name,
          columns: normaliseColumns(tableLevel[2]),
          predicate: null,
          file,
        });
        continue;
      }

      // Column-level: `colname type ... unique` or `... primary key`.
      // Guard against matching the table-level forms above, which have
      // already been handled and consumed by `continue`.
      const col = line.match(/^([a-z0-9_]+)\s+[a-z]/i);
      if (!col) continue;
      if (/\b(unique|primary\s+key)\b/i.test(line)) {
        out.push({
          name: `${name}_${col[1].toLowerCase()}_key`,
          table: name,
          columns: col[1].toLowerCase(),
          predicate: null,
          file,
        });
      }
    }
  }

  const alterRe =
    /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z0-9_]+)\s+add\s+constraint\s+([a-z0-9_]+)\s+(?:unique|primary\s+key)\s*\(([^)]+)\)/gi;
  for (const m of sql.matchAll(alterRe)) {
    out.push({
      name: m[2].toLowerCase(),
      table: m[1].toLowerCase(),
      columns: normaliseColumns(m[3]),
      predicate: null,
      file,
    });
  }

  return out;
}

/**
 * Replay every migration in filename order and return the indexes that
 * still exist at the end. Creates add, drops remove, so an index that
 * was created and later dropped correctly does not count against us.
 */
function liveIndexes(): IndexDef[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const live = new Map<string, IndexDef>();

  const createRe =
    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z0-9_]+)\s+on\s+(?:public\.)?([a-z0-9_]+)\s*(?:using\s+[a-z]+\s*)?\(([^)]*)\)([^;]*);/gi;
  const dropRe =
    /drop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi;

  for (const file of files) {
    const sql = stripComments(
      readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"),
    );

    for (const m of sql.matchAll(createRe)) {
      const [, name, table, cols, tail] = m;
      // [\s\S] rather than . with the dotAll flag: the `s` flag needs an
      // es2018 target and this project compiles below that.
      const whereMatch = tail.match(/where\s+([\s\S]+)$/i);
      live.set(name.toLowerCase(), {
        name: name.toLowerCase(),
        table: table.toLowerCase(),
        columns: normaliseColumns(cols),
        predicate: whereMatch
          ? whereMatch[1].trim().toLowerCase().replace(/\s+/g, " ")
          : null,
        file,
      });
    }

    for (const idx of impliedIndexes(sql, file)) {
      // A constraint-backed index cannot be dropped on its own, so it
      // is always the survivor of a pair. Registering it under a
      // distinct key means the plain index is the one reported.
      if (!live.has(idx.name)) live.set(idx.name, idx);
    }

    for (const m of sql.matchAll(dropRe)) {
      live.delete(m[1].toLowerCase());
    }
  }

  return [...live.values()];
}

describe("no table carries two identical indexes", () => {
  // Guard the guard. If the create-index regex ever stops matching,
  // the redundancy assertion below would pass vacuously over an empty
  // array. vitest.config.ts already records this exact failure mode
  // for a glob that matched no files: it looks like coverage.
  it("parses a realistic number of indexes out of the migrations", () => {
    const indexes = liveIndexes();
    expect(indexes.length).toBeGreaterThan(50);

    const tables = new Set(indexes.map((i) => i.table));
    expect(tables.size).toBeGreaterThan(20);

    // Partial indexes must survive parsing with their predicate, or
    // the redundancy check below would treat them as full indexes and
    // fire on legitimate pairs.
    expect(indexes.some((i) => i.predicate !== null)).toBe(true);
  });

  // Guard the guard, second layer, and the one this file needed most.
  //
  // Stubbing impliedIndexes() to return nothing left all the other
  // assertions green, because the duplicates it finds had already been
  // dropped. That is the blind spot this file shipped with, able to
  // return silently. These assertions fail the moment constraint
  // parsing stops working, whether or not any duplicate exists.
  it("sees indexes created by constraints, not just by create index", () => {
    const byName = new Map(liveIndexes().map((i) => [i.name, i]));

    // Column-level `unique` inside create table.
    expect(byName.has("account_transactions_external_transaction_id_key")).toBe(
      true,
    );
    expect(byName.get("firm_w9_forms_request_token_key")?.columns).toBe(
      "request_token",
    );

    // A composite key, so a single-column-only parser cannot pass this.
    const composite = [...byName.values()].filter(
      (i) => i.columns.includes(",") && i.name.endsWith("_key"),
    );
    expect(composite.length).toBeGreaterThan(0);

    // Constraint-implied entries must be a real share of the total, or
    // a parser that found one table and stopped would still pass.
    const implied = [...byName.values()].filter((i) =>
      i.name.endsWith("_key"),
    );
    expect(implied.length).toBeGreaterThan(5);
  });

  it("still sees the index the duplicate was removed in favour of", () => {
    // A drop-parsing bug that deleted too much would empty the map and
    // make the whole suite green for the wrong reason.
    const names = liveIndexes().map((i) => i.name);
    expect(names).toContain("mileage_points_raw_identity_uq");
    expect(names).toContain("mileage_points_raw_pending_idx");
    expect(names).not.toContain("mileage_points_raw_window_idx");
  });

  it("finds no two indexes with the same table, columns and predicate", () => {
    const seen = new Map<string, IndexDef>();
    const duplicates: string[] = [];

    for (const idx of liveIndexes()) {
      const key = `${idx.table}(${idx.columns})[${idx.predicate ?? ""}]`;
      const prior = seen.get(key);
      if (prior) {
        duplicates.push(
          `${idx.table}: ${prior.name} (${prior.file}) and ${idx.name} ` +
            `(${idx.file}) both index (${idx.columns})` +
            (idx.predicate ? ` where ${idx.predicate}` : ""),
        );
      } else {
        seen.set(key, idx);
      }
    }

    expect(
      duplicates,
      "Two indexes on the same columns cost write throughput and disk " +
        "and buy no read capability. Keep the one a constraint or an " +
        "upsert depends on, and drop the other.",
    ).toEqual([]);
  });
});
