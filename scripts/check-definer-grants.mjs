// CI guard: fails when a migration creates a SECURITY DEFINER function in
// `public` without revoking EXECUTE from anon.
//
// Why this class keeps recurring, and why a guard is the only cure:
//
// Postgres grants EXECUTE on a new function to PUBLIC by default. In a
// Supabase project PostgREST exposes `public` functions at /rest/v1/rpc/,
// and the `anon` role inherits PUBLIC. So a SECURITY DEFINER function is
// internet-facing the moment it is created, running with the definer's
// privileges, unless someone remembers to revoke. Nobody remembers, because
// nothing in the SQL says so: the migration reads as if it created a
// private helper.
//
// Three findings from the 2026-08-01 audits were exactly this, all fixed
// one at a time rather than as a class:
//
//   * mileage_broken_trips        cross-tenant trip data to anyone, no session
//   * purge_expired_recycle_bin   an unauthenticated destructive action
//   * passkey_lookup_by_email     an account-existence and identity oracle
//
// and two more were found still live a week later:
//
//   * lookup_w9_request / submit_w9_form  a plaintext TIN writable through
//                                         PostgREST, and an already-signed
//                                         W-9 overwritable for 90 days
//
// At the time of writing, 34 of ~40 SECURITY DEFINER functions in `public`
// remain anon-executable. This guard does not fix those; it stops the
// number growing, which is the part a script can actually own.
//
// DESIGN: static, and deliberately so. Like scripts/check-migration-order.mjs
// this compares against origin/main and never touches the database, so CI
// needs no credentials and can leak nothing. The trade-off is real and worth
// stating: it can only see what a migration FILE says. A function created or
// granted out of band, straight against production, is invisible here. That
// anti-pattern is documented in docs/migration-history-state.md and is what
// produced most of the current backlog.
//
// THE ESCAPE HATCH. Some functions are meant to be anon-callable: an
// invitation lookup has to work before the invitee has an account. Mark them
// in the migration and say why:
//
//   -- definer-grant-ok: lookup_invitation  anonymous invitees resolve a token
//                                           before they can possibly have a session
//
// The reason is required. A bare marker is rejected, because "someone typed
// the magic comment" is not a review.
//
// Usage:
//   node scripts/check-definer-grants.mjs [--base-ref=origin/main]
//   node scripts/check-definer-grants.mjs --all     # every migration, for audit

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * Analyse one migration's SQL.
 *
 * Exported for the unit tests. Pure: takes text, returns findings, touches
 * nothing.
 *
 * @param {string} sql
 * @returns {{name: string, revoked: boolean, allowlisted: boolean, reason: string}[]}
 */
export function analyzeMigrationSql(sql) {
  // Allowlist markers first, before any comment stripping, since the marker
  // lives in a comment. The reason must be non-empty after the name.
  const allowlisted = new Map();
  // `[ \t]` and not `\s`: \s matches newlines, so a BARE marker would run on
  // to the next line and capture the following `create function ...` as its
  // "reason", making the required-justification check pass for a marker that
  // has no justification at all. Caught by its own test.
  const markerRe = /--[ \t]*definer-grant-ok:[ \t]*([A-Za-z0-9_]+)[ \t]+(\S[^\n]*)$/gim;
  for (const m of sql.matchAll(markerRe)) {
    allowlisted.set(m[1].toLowerCase(), m[2].trim());
  }

  // Find every created function and the text that follows it, up to the next
  // `create ... function` or end of file. `security definer` has to appear in
  // that window to count, so a plain (invoker-rights) function is ignored.
  const createRe =
    /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([A-Za-z0-9_]+)"?\s*\(/gi;

  const matches = [...sql.matchAll(createRe)];
  const findings = [];

  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1];
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? sql.length) : sql.length;
    const body = sql.slice(start, end);

    if (!/\bsecurity\s+definer\b/i.test(body)) continue; // invoker rights, fine

    // Does the migration revoke it from anon anywhere? Accepts both the
    // explicit form and the dynamic DO-block loop used by
    // 20260808060000_revoke_anon_execute_on_w9_rpcs.sql, which names its
    // targets in a `proname in (...)` list rather than in a literal REVOKE.
    const lower = sql.toLowerCase();
    const nameLower = name.toLowerCase();
    const mentionsAnonRevoke = /revoke[\s\S]{0,400}?\bfrom\b[\s\S]{0,120}?\banon\b/i.test(sql);
    const namedNearRevoke =
      lower.includes(nameLower) &&
      // the name has to appear somewhere in the same file as a revoke, which
      // for the dynamic form is the proname list
      mentionsAnonRevoke;

    findings.push({
      name,
      revoked: namedNearRevoke,
      allowlisted: allowlisted.has(nameLower),
      reason: allowlisted.get(nameLower) ?? "",
    });
  }

  return findings;
}

/**
 * Migrations present locally but not at baseRef, i.e. new in this PR.
 *
 * Uses `git ls-tree` and a set difference rather than `git diff base...HEAD`.
 * That is not a style preference: the three-dot diff needs a MERGE BASE, and
 * CI fetches main with --depth=1 onto an already-shallow PR checkout, so
 * there is no common ancestor and git fails with
 *   fatal: origin/main...HEAD: no merge base
 * The guard then exited 2 and failed its own PR. ls-tree just reads a tree
 * at a ref, needs no shared history, and is what check-migration-order.mjs
 * already does for the same reason.
 */
function changedMigrationFiles(baseRef) {
  let baseFiles;
  try {
    const out = execFileSync(
      "git",
      ["ls-tree", "-r", "--name-only", baseRef, "--", MIGRATIONS_DIR],
      { encoding: "utf8" },
    );
    baseFiles = new Set(
      out.split("\n").map((s) => s.trim()).filter((s) => s.endsWith(".sql")),
    );
  } catch (e) {
    console.error(
      `Could not read ${MIGRATIONS_DIR} at ${baseRef}: ${e.message}\n` +
        `Fetch it first, e.g.\n` +
        `  git fetch origin main:refs/remotes/origin/main --depth=1`,
    );
    process.exit(2);
  }
  return allMigrationFiles().filter((f) => !baseFiles.has(f));
}

function allMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const baseRef =
    args.find((a) => a.startsWith("--base-ref="))?.split("=")[1] ?? "origin/main";

  const files = all ? allMigrationFiles() : changedMigrationFiles(baseRef);
  const problems = [];
  let definerCount = 0;
  let allowedCount = 0;

  for (const file of files) {
    let sql;
    try {
      sql = readFileSync(file, "utf8");
    } catch {
      continue; // deleted in a later commit of the same PR
    }
    for (const f of analyzeMigrationSql(sql)) {
      definerCount++;
      if (f.allowlisted) {
        allowedCount++;
        continue;
      }
      if (!f.revoked) problems.push({ file, name: f.name });
    }
  }

  if (problems.length > 0) {
    console.error(
      `\nSECURITY DEFINER function(s) created without revoking EXECUTE from anon:\n`,
    );
    for (const p of problems) {
      console.error(`  ${p.file}`);
      console.error(`    public.${p.name}()\n`);
    }
    console.error(
      `Postgres grants EXECUTE to PUBLIC by default, and Supabase's \`anon\`\n` +
        `role inherits PUBLIC, so each of these is callable by anyone on the\n` +
        `internet at /rest/v1/rpc/ with the definer's privileges.\n\n` +
        `Add to the same migration:\n\n` +
        `  revoke execute on function public.<name>(<args>)\n` +
        `    from anon, authenticated, public;\n\n` +
        `See supabase/migrations/20260808060000_revoke_anon_execute_on_w9_rpcs.sql\n` +
        `for a version that loops over OIDs, so an overload or a signature\n` +
        `change cannot silently turn the revoke into a no-op.\n\n` +
        `If the function is GENUINELY meant to be anon-callable, say so and\n` +
        `say why:\n\n` +
        `  -- definer-grant-ok: <name>  <why anon must be able to call it>\n`,
    );
    process.exit(1);
  }

  const scope = all ? `${files.length} migration(s)` : `${files.length} new migration(s)`;
  console.log(
    `Definer-grant guard: ${scope} checked, ${definerCount} SECURITY DEFINER function(s), ` +
      `${allowedCount} explicitly allowlisted, no problems found.`,
  );
}

// Only run the CLI when executed directly, so the test can import the pure part.
if (process.argv[1] && process.argv[1].endsWith("check-definer-grants.mjs")) {
  main();
}
