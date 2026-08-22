/**
 * The `role` vocabulary, held in place. Fleet contract section 4.1a, step 5.
 *
 * 4.1a is new in revision C. It is a written exchange with the Hub operator
 * rather than code, and the document itself is docs/design/fleet-role-vocabulary.md.
 * Only its last step is a test:
 *
 *   "Assert that exact string in a test, so a later change to your own role
 *    vocabulary that drops or renames it fails your build rather than the
 *    Hub's next call."
 *
 * The reason it matters more than it looks: an unrecognized `role` is a `422`
 * under 4.1, so a mismatch is not a degraded call, it is a provisioning
 * failure on EVERY call, and it fails on the first one before anybody can
 * notice a pattern.
 *
 * WHAT IS ASSERTED NOW AND WHAT WAITS
 *
 * The exact string the Hub will send is open question 10 and only the operator
 * can give it. It is not being guessed here: `HUB_CONFIGURED_ROLE` is null
 * until the confirmation arrives in writing, and the assertion that uses it
 * skips itself and says why. What does not wait is the vocabulary: all four
 * values are asserted against the migration that declares the enum and against
 * the type in lib/auth.ts, so a rename or a drop fails CI today, which is the
 * failure step 5 exists to move earlier.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationSql } from "./catalog";

const REPO_ROOT = join(__dirname, "..", "..");

/**
 * The vocabulary, as literal strings with the case as written, from
 * `public.company_role`. Sent to the Hub operator under 4.1a step 1.
 */
const COMPANY_ROLE_VALUES = ["manager", "member", "lead", "expenser"] as const;

/**
 * The value the Hub operator has confirmed in writing that the Hub will send.
 *
 * Open question 10. Null until that confirmation exists. Do not fill this in
 * from the recommendation in the handover document: the recommendation is what
 * we asked for, and section 0 is explicit that a local answer to a [VERIFY]
 * item is how two products in the fleet diverge.
 */
const HUB_CONFIGURED_ROLE: string | null = null;

const ALL_SQL = migrationSql()
  .map((m) => m.sql)
  .join("\n");

describe("the role vocabulary is what was sent to the Hub operator", () => {
  it("declares company_role in a migration", () => {
    // Guards the guard. Every assertion below reads this declaration, and a
    // regex that stopped matching would make all of them vacuous.
    expect(
      /create\s+type\s+public\.company_role\s+as\s+enum/i.test(ALL_SQL),
      "public.company_role is no longer declared in any migration",
    ).toBe(true);
  });

  it("still accepts every value in the handover document", () => {
    /**
     * The enum was created with two values and grew to four by `alter type ...
     * add value`, so the set is assembled from the whole migration history
     * rather than from the create statement. What matters is that each literal
     * string is still declared somewhere, because each one is a string the
     * operator may have been given.
     */
    for (const role of COMPANY_ROLE_VALUES) {
      const declared =
        new RegExp(
          `create\\s+type\\s+public\\.company_role\\s+as\\s+enum\\s*\\([^)]*'${role}'`,
          "i",
        ).test(ALL_SQL) ||
        new RegExp(
          `alter\\s+type\\s+public\\.company_role\\s+add\\s+value[^;]*'${role}'`,
          "i",
        ).test(ALL_SQL);
      expect(
        declared,
        `'${role}' is no longer a company_role value. It was sent to the Hub ` +
          `operator under section 4.1a step 1 as a literal string this product ` +
          `accepts. If the Hub is configured with it, every provision_user ` +
          `call now returns 422 on the first attempt. Tell the operator before ` +
          `this ships, do not just update this test.`,
      ).toBe(true);
    }
  });

  it("still carries every value in the application's own type", () => {
    // The database enum and the TypeScript union have to agree, or a value the
    // operator was given is accepted by Postgres and rejected by the route
    // that has not been written yet.
    const auth = readFileSync(join(REPO_ROOT, "lib", "auth.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(?<!:)\/\/[^\n]*/g, "");
    const union = auth.match(/role:\s*((?:"[a-z]+"\s*\|\s*)*"[a-z]+")/);
    expect(union, "the CompanyMembership role union moved or was renamed").not.toBeNull();
    const declared = [...union![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
    expect(
      declared,
      "lib/auth.ts and public.company_role disagree about the role vocabulary. " +
        "The set in docs/design/fleet-role-vocabulary.md was read from the " +
        "database, so a drift here means the document sent to the Hub operator " +
        "is now wrong.",
    ).toEqual([...COMPANY_ROLE_VALUES].sort());
  });

  it("holds the Hub's confirmed value, once there is one", () => {
    if (HUB_CONFIGURED_ROLE === null) {
      // Open question 10. Deliberately not answered locally. The assertion
      // above already fails the build on a rename, which is the half of step 5
      // that does not need the operator.
      expect(HUB_CONFIGURED_ROLE).toBeNull();
      return;
    }
    expect(
      COMPANY_ROLE_VALUES as readonly string[],
      `the Hub is configured to send '${HUB_CONFIGURED_ROLE}' for this product ` +
        `and this product no longer accepts it. Every provision_user call is ` +
        `now a 422.`,
    ).toContain(HUB_CONFIGURED_ROLE);
  });
});

describe("no unknown role is mapped onto a default", () => {
  /**
   * 4.1a step 3, confirmed back to the operator in the handover document:
   * "Do not map an unknown value onto a default, because a silent map is how a
   * prospect ends up with a permission level nobody chose."
   *
   * There is no provisioning code to check yet, so what is asserted is the
   * negative that keeps the promise true: nothing in this product coerces an
   * arbitrary string into a company_role. The day a route is written, the
   * temptation is a one-line `?? "member"`, and it would be invisible.
   */
  it("nothing in the fleet module coerces a role", () => {
    const fleetFiles = ["lib/hq/catalog.ts", "lib/hq/sandbox-seed.ts"];
    for (const rel of fleetFiles) {
      const src = readFileSync(join(REPO_ROOT, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<!:)\/\/[^\n]*/g, "");
      expect(
        /role[^;\n]*\?\?\s*["'][a-z]+["']|role[^;\n]*\|\|\s*["'][a-z]+["']/.test(src),
        `${rel} defaults a role. Section 4.1a step 3: an unrecognized value is ` +
          `a 422, never a map onto a default.`,
      ).toBe(false);
    }
  });
});
