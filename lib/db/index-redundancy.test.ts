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
