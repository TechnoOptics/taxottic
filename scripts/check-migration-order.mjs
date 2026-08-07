// CI guard: fails when supabase/migrations contains a file whose
// timestamp cannot safely apply after everything already merged.
//
// Built after one night (2026-08-06/07) where this exact bug class hit
// three times in a row:
//
//   1. 20260801000200_bank_import_scoped_visibility.sql (RLS fix for a
//      live cross-user data leak): production had already applied
//      migrations through 20260808000100. The Supabase CLI refused the
//      pending migration and suggested --include-all.
//   2. 20260801000200_mileage_render_refusals.sql (fabricated-mileage
//      gate): `supabase db push` printed "Remote database is up to
//      date" and exited 0 having done nothing. Had it merged, the code
//      would have shipped writing to a table that was never created.
//   3. 20260808000000_bank_imports_complete.sql: --include-all would
//      have worked that day, then broken every fresh replay (db reset,
//      CI, a new environment), because it sorted before a migration it
//      depended on.
//
// Every one of those was caught only because a human read dry-run
// output instead of trusting the exit code. This script is that human,
// running automatically on every PR.
//
// Design: this compares against the highest timestamp already
// committed on origin/main, not against the live production database.
// That is a weaker check: a migration applied out of band straight to
// production (the exact anti-pattern documented in
// docs/migration-history-state.md) would not be visible here, and a
// migration merged to main but not yet pushed to prod could still let
// a later PR's file sort in ahead of it. But it needs no database
// credentials, so it cannot leak anything, and it still catches all
// three incidents above, because all three were about file order
// within the repo, not a mismatch between the repo and prod. See
// docs/migration-history-state.md for the fuller argument.
//
// Usage:
//   node scripts/check-migration-order.mjs [--base-ref=origin/main]

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

export const MIGRATIONS_DIR = "supabase/migrations";

// 14-digit YYYYMMDDHHMMSS prefix, underscore, name, .sql. Every file in
// supabase/migrations matches this today; a file that doesn't is a
// different problem than this script checks for, so it's skipped
// rather than failed here.
const TIMESTAMP_RE = /^(\d{14})_.+\.sql$/;

export function parseMigrationFilename(filename) {
  const match = TIMESTAMP_RE.exec(filename);
  if (!match) return null;
  return { file: filename, timestamp: match[1] };
}

// Any timestamp used by more than one file is a bug: only one can ever
// be recorded in supabase_migrations.schema_migrations, so the other
// silently never runs when the database is rebuilt from scratch. This
// happened once already: 20260725000000 was used by both
// mileage_trip_source and tracker_alerts_kind.
export function findDuplicateTimestamps(filenames) {
  const byTimestamp = new Map();
  for (const filename of filenames) {
    const parsed = parseMigrationFilename(filename);
    if (!parsed) continue;
    const list = byTimestamp.get(parsed.timestamp) ?? [];
    list.push(parsed.file);
    byTimestamp.set(parsed.timestamp, list);
  }
  const duplicates = [];
  for (const [timestamp, files] of byTimestamp) {
    if (files.length > 1) duplicates.push({ timestamp, files: [...files].sort() });
  }
  return duplicates.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// A file that exists in the working tree but not at baseRef is "new" -
// something this PR is adding. A new file must sort strictly after
// every migration baseRef already has, or it risks being silently
// skipped (case 2 above) or forcing an out-of-order replay (cases 1
// and 3). Files that already existed at baseRef are left alone: the
// entire pre-existing history is, by construction, already in order.
export function findOutOfOrderMigrations(workingFilenames, baseFilenames) {
  const baseSet = new Set(baseFilenames);
  const baseEntries = baseFilenames.map(parseMigrationFilename).filter(Boolean);
  if (baseEntries.length === 0) return [];

  const newest = baseEntries.reduce((max, entry) => (entry.timestamp > max.timestamp ? entry : max));

  const problems = [];
  for (const filename of workingFilenames) {
    if (baseSet.has(filename)) continue;
    const parsed = parseMigrationFilename(filename);
    if (!parsed) continue;
    if (parsed.timestamp <= newest.timestamp) {
      problems.push({
        file: parsed.file,
        timestamp: parsed.timestamp,
        newestBaseTimestamp: newest.timestamp,
        newestBaseFile: newest.file,
      });
    }
  }
  return problems.sort((a, b) => a.file.localeCompare(b.file));
}

function nextTimestampAfter(timestamp) {
  return String(BigInt(timestamp) + 1n).padStart(14, "0");
}

export function formatOrderError({ file, timestamp, newestBaseTimestamp, newestBaseFile }, baseRef) {
  const suggested = nextTimestampAfter(newestBaseTimestamp);
  return (
    `${MIGRATIONS_DIR}/${file} has timestamp ${timestamp}, which is not newer than ` +
    `${newestBaseTimestamp}, the newest migration already committed on ${baseRef} ` +
    `(${MIGRATIONS_DIR}/${newestBaseFile}). A file timestamped this way is either ` +
    `silently skipped by "supabase db push" against a database that already has ` +
    `the newer migration applied, or it forces --include-all and then replays out ` +
    `of order on every fresh environment (db reset, CI, a new project). ` +
    `Fix: rename ${file} to start with a timestamp after ${newestBaseTimestamp}, ` +
    `for example ${suggested}.`
  );
}

export function formatDuplicateError({ timestamp, files }) {
  return (
    `Timestamp ${timestamp} is used by ${files.length} migration files: ${files.join(", ")}. ` +
    `Only one version can ever be recorded as applied in supabase_migrations.schema_migrations, ` +
    `so the rest silently never run when a database is rebuilt from these files ` +
    `(this already happened once, with 20260725000000). ` +
    `Fix: rename all but one of these files to a unique timestamp.`
  );
}

function listMigrationsInWorkingTree() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function listMigrationsAtRef(ref) {
  const out = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", MIGRATIONS_DIR], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(Boolean)
    .map((p) => p.slice(MIGRATIONS_DIR.length + 1))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function main() {
  const baseRefArg = process.argv.find((a) => a.startsWith("--base-ref="));
  const baseRef = baseRefArg
    ? baseRefArg.slice("--base-ref=".length)
    : process.env.MIGRATION_ORDER_BASE_REF || "origin/main";

  const working = listMigrationsInWorkingTree();

  let base;
  try {
    base = listMigrationsAtRef(baseRef);
  } catch (e) {
    console.error(`Could not read ${MIGRATIONS_DIR} at ${baseRef}: ${e.message}`);
    console.error(`This check needs ${baseRef} fetched locally, for example: git fetch origin main --depth=1`);
    process.exitCode = 1;
    return;
  }

  const duplicates = findDuplicateTimestamps(working);
  const outOfOrder = findOutOfOrderMigrations(working, base);

  if (duplicates.length === 0 && outOfOrder.length === 0) {
    console.log(`Migration order guard: ${working.length} files checked against ${baseRef}, no problems found.`);
    return;
  }

  console.error("Migration order guard failed.\n");
  for (const d of duplicates) console.error(formatDuplicateError(d) + "\n");
  for (const o of outOfOrder) console.error(formatOrderError(o, baseRef) + "\n");
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
