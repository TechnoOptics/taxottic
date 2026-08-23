/**
 * The call sites that bypass the one predicate, accounted for.
 *
 * Fleet contract section 6.3, strengthened in revision C. Revision B left this
 * implied; revision C states it:
 *
 *   "The predicate must bind your own elevated code paths, and this is the part
 *    that is missed. ... A predicate that any of those skip is not the single
 *    enforcement point this section requires, however strong the mechanism
 *    looks on paper. The first row of the table above is true of a caller
 *    subject to the policy and says nothing about a caller that is not."
 *
 * and it names the platform: "On at least one widely used platform the
 * application's own service role carries a bypass attribute by default, and
 * every call site holding it sits outside the boundary until it is bound to a
 * tenant." That is this platform. Measured on production project
 * enisnjjbxqaliydepacc: `service_role` has `rolbypassrls = true`.
 *
 * WHAT 6.3 ASKS FOR, AND WHERE EACH PART LIVES
 *
 *   1. Enumerate every bypassing call site and every bypassing database object
 *      from the codebase, not from memory, counting inline constructions as
 *      well as imports of a shared helper.   -> this file
 *   2. Bind each one to a tenant, or state plainly that it is not yet bound.
 *      "An unbound call site is an open boundary, not a closed one with a
 *      caveat."                              -> docs/design/fleet-integration.md
 *   3. Where the database can force the policy on the table owner, turn it on.
 *      -> reported, not done. `force row level security` binds the table OWNER;
 *         `rolbypassrls` is a role attribute and outranks it, so forcing would
 *         not close this gap. Recorded in the design doc rather than performed.
 *   4. A test that fails when a new unbound call site appears.  -> this file
 *
 * WHY THE INLINE PROBE IS SEPARATE FROM THE COUNT
 *
 * 6.3: "Count the ones that construct a privileged client inline as well as the
 * ones that import a shared helper: an import-path audit misses the inline ones
 * entirely." So the counts below track the helper, and a second, independent
 * probe tracks construction from the service-role key regardless of which
 * helper is involved. A refactor that replaces `createServiceClient` with a
 * hand-rolled client would leave the first probe reading zero and is caught by
 * the second.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { SANDBOX_KEYED_TABLES, TENANT_FREE_TABLES } from "./sandbox-exclusion";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const SCANNED = ["app", "lib", "components", "scripts", "supabase"];

/** The one sanctioned definition. Excluded from call-site counts. */
const HELPER = "lib/supabase/server.ts";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|mjs)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments. A call site named in prose is not a call site. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "");
}

const ALL_FILES = SCANNED.flatMap((d) => sourceFiles(join(REPO_ROOT, d)));
const rel = (f: string) => f.slice(REPO_ROOT.length + 1);

/** Every invocation of the shared privileged helper, and the files holding them. */
function helperCallSites(): { invocations: number; files: string[] } {
  let invocations = 0;
  const files: string[] = [];
  for (const f of ALL_FILES) {
    if (rel(f) === HELPER) continue;
    const calls = code(f).match(/createServiceClient\s*\(\s*\)/g);
    if (!calls) continue;
    invocations += calls.length;
    files.push(rel(f));
  }
  return { invocations, files: files.sort() };
}

/**
 * Every file that builds a privileged client without going through the helper.
 * This is the class an import-path audit misses.
 */
function inlineConstructions(): string[] {
  return ALL_FILES.filter((f) => {
    const src = code(f);
    return (
      /SUPABASE_SERVICE_ROLE_KEY/.test(src) &&
      /create(Server)?Client\s*\(/.test(src)
    );
  })
    .map(rel)
    .sort();
}

/**
 * The measurement of record, taken on this tree. Section 6.3 wants a number
 * that moves when a call site is added, so these are ceilings rather than
 * exact equalities: removing one is progress and must not fail a build, while
 * adding one is a new open boundary and must.
 *
 * Regenerate by running this file and reading the failure message.
 */
const MEASURED = {
  invocations: 75,
  files: 70,
};

describe("the elevated call-site scan is not vacuous", () => {
  it("reads a realistic tree and finds the helper's definition", () => {
    expect(ALL_FILES.length).toBeGreaterThan(500);
    expect(code(join(REPO_ROOT, HELPER))).toMatch(
      /export function createServiceClient/,
    );
  });

  it("strips comments, so a call site named in prose does not count", () => {
    const probe = "/* createServiceClient() */\nconst x = 1;";
    expect(
      probe
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<!:)\/\/[^\n]*/g, "")
        .includes("createServiceClient"),
    ).toBe(false);
  });

  it("finds the call sites at all", () => {
    expect(helperCallSites().invocations).toBeGreaterThan(50);
  });
});

describe("no new call site bypasses the predicate", () => {
  const FAILURE =
    "Section 6.3: every call site holding the service role sits outside the " +
    "boundary until it is bound to a tenant, and an unbound call site is an " +
    "open boundary, not a closed one with a caveat. Bind the new one to a " +
    "tenant, or route it through a caller that cannot be called without one. " +
    "If neither is possible yet, raise the count here in the same commit and " +
    "record the site in docs/design/fleet-integration.md, so the number the " +
    "Hub operator is given stays true.";

  it("does not add an invocation of the shared privileged helper", () => {
    const { invocations } = helperCallSites();
    expect(invocations, FAILURE).toBeLessThanOrEqual(MEASURED.invocations);
  });

  it("does not add a file that holds the shared privileged helper", () => {
    const { files } = helperCallSites();
    expect(files.length, FAILURE).toBeLessThanOrEqual(MEASURED.files);
  });

  it("holds no unbound elevated client in the operator console", () => {
    // The design doc's own sequencing recommendation, and 6.7 failure mode 2:
    // the internal dashboard that counts all rows is the surface where
    // "nothing sandboxed gets out" actually breaks, and it is the smallest
    // file set, so it is the one held exactly rather than as a ceiling.
    //
    // Zero, not a ceiling. Every read under app/admin/ now goes through
    // createSandboxExcludingClient, whose fetch applies the boundary. A file
    // here that reaches for the plain helper has stepped back outside it.
    const { files } = helperCallSites();
    const admin = files.filter((f) => f.startsWith("app/admin/"));
    expect(
      admin,
      `${FAILURE} This one is under app/admin/, which is where a sandbox row ` +
        `becomes a line in a report a real person reads. Use ` +
        `createSandboxExcludingClient() from lib/hq/elevated-client instead.`,
    ).toEqual([]);
  });

  it("keeps the fetch-taking service client to its one sanctioned caller", () => {
    // createServiceClientWithFetch() is how the chokepoint gets a privileged
    // client whose every read is rewritten. It is invisible to the invocation
    // count above, which matches `createServiceClient()` exactly, so a second
    // caller would be a bypass that no number in this file moves. One caller,
    // named here.
    const callers = ALL_FILES.filter((f) =>
      /createServiceClientWithFetch\s*\(/.test(code(f)),
    )
      .map(rel)
      .sort();
    expect(
      callers,
      "createServiceClientWithFetch() has a new caller. It builds a " +
        "service-role client and is not counted by the invocation ceiling " +
        "above, so a second caller is an unbound call site that moves no " +
        "number. Route the new code through createSandboxExcludingClient(), " +
        "or argue for it here.",
    ).toEqual(["lib/hq/elevated-client.ts", "lib/supabase/server.ts"]);
  });

  it("keeps the boundary-read client to its sanctioned callers", () => {
    /**
     * createBoundaryReadClient() is a factory in lib/hq/elevated-client.ts
     * holding ONE `createServiceClient()` occurrence, so a second call path to
     * it adds a privileged runtime client while moving no number in the
     * invocation ceiling above. That is precisely the shape 6.3 warns about,
     * so the callers are named rather than counted.
     *
     * Both existing callers make the same read and no other: which tenants are
     * sandboxes and who is inside them. That read cannot be bound by the
     * boundary, because it is the read that defines the boundary. Anything
     * else reaching for this factory is an ordinary unbound elevated call
     * site wearing the boundary's name.
     */
    const callers = ALL_FILES.filter((f) =>
      /createBoundaryReadClient\s*\(/.test(code(f)),
    )
      .map(rel)
      .sort();
    expect(
      callers,
      "createBoundaryReadClient() has a new caller. It vends a service-role " +
        "client from a single invocation, so a new caller is an unbound call " +
        "site that the ceiling above cannot see. It exists only for the read " +
        "that defines the sandbox boundary. If the new caller needs a " +
        "privileged client for anything else, call createServiceClient() and " +
        "raise the ceiling, so the number the Hub operator is given stays true.",
    ).toEqual([
      "lib/email/transport.ts",
      "lib/hq/elevated-client.ts",
    ]);
  });

  it("classifies every table the operator console reads", () => {
    // 6.3 asks that each elevated site be bound to a tenant or stated plainly
    // as unbound. The console's client refuses a table it cannot place, so
    // this assertion is what turns that runtime refusal into a build failure
    // rather than a broken internal page discovered by an operator.
    const read = new Set<string>();
    for (const f of ALL_FILES) {
      if (!rel(f).startsWith("app/admin/")) continue;
      for (const m of code(f).matchAll(/\.from\(\s*"([a-z_]+)"/g)) {
        read.add(m[1]);
      }
    }
    const unclassified = [...read]
      .filter((t) => !(t in SANDBOX_KEYED_TABLES) && !(t in TENANT_FREE_TABLES))
      .sort();
    expect(
      unclassified,
      "the operator console reads a table the sandbox boundary has no entry " +
        "for. Add it to SANDBOX_KEYED_TABLES in lib/hq/sandbox-exclusion.ts " +
        "with the column that ties a row to a tenant, or to " +
        "TENANT_FREE_TABLES with the reason it holds no tenant row. Until " +
        "then the page throws at runtime, by design.",
    ).toEqual([]);
  });

  it("constructs a privileged client inline in exactly the two known places", () => {
    /**
     * Exact equality, not a ceiling, and deliberately so. This is 6.3's named
     * trap: a hand-rolled privileged client is invisible to a count of helper
     * invocations, so the count above could read zero while the boundary is
     * wide open. Two files are allowed to hold the service-role key next to a
     * client constructor:
     *
     *   lib/supabase/server.ts            the helper itself, the one definition
     *   scripts/backfill-sign-convention  a one-off maintenance script, run by
     *                                     hand, not reachable from any request
     *
     * A third is a new bypass shape and has to be argued for, not counted.
     */
    expect(
      inlineConstructions(),
      "a privileged client is now constructed outside the one helper. Section " +
        "6.3 says an import-path audit misses exactly this, which is why it is " +
        "probed separately. Route it through createServiceClient(), or add it " +
        "here with the reason it cannot be.",
    ).toEqual([
      "lib/supabase/server.ts",
      "scripts/backfill-sign-convention.ts",
    ]);
  });
});

describe("no sandbox tenant can exist while those call sites are unbound", () => {
  /**
   * This is the control, and the rest of the file is the measurement.
   *
   * 6.3 offers three ways out for a codebase in this shape: carry the tenant
   * identity on the connection, route the paths through a single accessor that
   * cannot be called without a tenant, or "report the gap to the Hub operator
   * as an open boundary and sequence it before the first sandbox tenant
   * exists". This product takes the third, so the sequencing has to be
   * enforced by something other than intention.
   *
   * `companies.sandbox` exists in production and defaults to false. Nothing in
   * this repository sets it. While that holds, the 91 unbound call sites read
   * real tenants only, which is the state they were written for, and the
   * boundary's gap has no sandbox row to leak. The day provisioning is built,
   * this test fails, and the call-site work has to be finished first rather
   * than noticed afterwards.
   */
  it("nothing writes a true value into the tenant flag", () => {
    const writers = ALL_FILES.filter((f) => {
      const src = code(f);
      return /\bsandbox\b\s*:\s*true|\bsandbox\b\s*=\s*true|"sandbox"\s*,\s*true/.test(
        src,
      );
    }).map(rel);
    expect(
      writers,
      "something now creates a sandbox tenant. Section 6.3 requires the " +
        "elevated call sites to be bound to a tenant before the first sandbox " +
        "tenant exists, because the predicate does not hold for a caller that " +
        "carries the bypass attribute. Finish that work, or do not provision.",
    ).toEqual([]);
  });

  it("the definer-grant guard still runs in CI", () => {
    // 6.3 asks for every bypassing DATABASE OBJECT as well as every call site.
    // A `security definer` function runs with the definer's rights and is a
    // bypass by construction. The live count on enisnjjbxqaliydepacc is 42
    // definer functions in `public`, 33 of them anon-executable; the number is
    // in docs/design/fleet-integration.md. This repository already owns that
    // class through a CI guard, so the assertion here is that the guard is
    // still wired, not a second copy of it.
    const ci = readFileSync(
      join(REPO_ROOT, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    expect(
      ci.includes("node scripts/check-definer-grants.mjs"),
      "ci.yml no longer runs scripts/check-definer-grants.mjs. That guard is " +
        "this repository's only check on new bypassing database objects, which " +
        "section 6.3 requires to be enumerated alongside call sites.",
    ).toBe(true);
  });
});
