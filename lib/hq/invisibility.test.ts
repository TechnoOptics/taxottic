/**
 * "The visitor must not be able to tell." Fleet contract section 6.6.
 *
 * The third of the three things that fail if you get them wrong. A prospect
 * inside a sandbox tenant must not learn they are in one, and section 6.6
 * names the exact places it leaks: banners, page titles, email subjects, PDF
 * footers, export filenames, error messages.
 *
 * WHY THIS IS A NARROW GREP AND NOT A REPO-WIDE ONE
 *
 * A repo-wide grep for "demo", "test" and "sample" in this codebase returns
 * hundreds of hits and every one of them is noise: `--no-sandbox` is a Chrome
 * launch flag, `.test.ts` is a filename, "Book a 20-minute demo" is marketing
 * copy on a public page that every real visitor also sees, `PLAID_ENV` has a
 * "sandbox" value that is Plaid's environment and not ours. A guard that
 * cries wolf on all of those gets disabled within a month.
 *
 * So this checks the surfaces section 6.6 actually enumerates, and only
 * those. What was measured and deliberately excluded is listed in
 * docs/design/fleet-integration.md so the next person can see the boundary of
 * the claim rather than assuming it is total.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SANDBOX_SEED } from "./sandbox-seed";

const REPO_ROOT = join(__dirname, "..", "..");

/** Section 6.6's list, verbatim, plus the two phrases it spells out. */
const TELLS = [
  "demo",
  "sandbox",
  "trial",
  "test",
  "sample",
  "evaluation",
  "not a real",
  "for demonstration purposes",
];

/**
 * The surfaces the visitor sees. Each entry is a directory or file whose
 * string content reaches a prospect: an inbox, a PDF, a downloaded file.
 */
const VISITOR_SURFACES = [
  "lib/email/templates",
  "lib/firm/documents/generate.ts",
  "lib/firm/documents/generate-1040.ts",
  "lib/firm/documents/generate-1099.ts",
  "lib/firm/documents/generate-k1.ts",
  "lib/firm/documents/generate-schedule-c.ts",
  "lib/firm/documents/generate-entity-return.ts",
];

/**
 * Surfaces that contain a listed word for a reason unrelated to the sandbox.
 *
 * The reason is required, and it is checked. A bare exclusion would let
 * someone silence a real finding by adding a path, which is how a guard stops
 * being a guard. Same shape as the `definer-grant-ok` markers in
 * scripts/check-definer-grants.mjs.
 *
 * Each entry is also asserted to still exist and still contain the word: an
 * exclusion that has gone stale is coverage quietly lost, and it should fail
 * loudly rather than sit here forever.
 */
const EXCLUSIONS: { file: string; word: string; reason: string }[] = [
  {
    file: "lib/email/templates/beta-invite.ts",
    word: "test",
    reason:
      "This is the TestFlight / Play beta invitation, sent only from the " +
      "admin beta-invite console to a named tester. It is not on any path a " +
      "fleet sandbox prospect can reach. If provisioning ever reuses this " +
      "template, the subject line 'invited you to test Taxottic' becomes a " +
      "section 6.6 violation on the first send.",
  },
];

function filesUnder(rel: string): string[] {
  const full = join(REPO_ROOT, rel);
  if (!statSync(full).isDirectory()) return [full];
  const out: string[] = [];
  for (const entry of readdirSync(full)) {
    const child = join(full, entry);
    if (statSync(child).isDirectory()) out.push(...filesUnder(join(rel, entry)));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(child);
  }
  return out;
}

/** Strip // and block comments. A guard that matches a comment is not a guard. */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("no sandbox tell reaches a visitor-facing surface", () => {
  it("finds the surfaces it is meant to check", () => {
    // Guards the guard. If a rename empties this list the assertion below
    // passes over nothing and reports success for an unchecked codebase.
    const all = VISITOR_SURFACES.flatMap(filesUnder);
    expect(all.length).toBeGreaterThan(8);
    for (const f of all) expect(readFileSync(f, "utf8").length).toBeGreaterThan(0);
  });

  it("keeps every exclusion honest", () => {
    // An exclusion with no reason, or one whose file no longer contains the
    // word, is coverage lost with nothing reporting it.
    for (const e of EXCLUSIONS) {
      expect(e.reason.length, `${e.file}: exclusion has no reason`).toBeGreaterThan(60);
      const src = stripTsComments(
        readFileSync(join(REPO_ROOT, e.file), "utf8"),
      );
      expect(
        new RegExp(`\\b${e.word}\\b`, "i").test(src),
        `${e.file}: excluded for "${e.word}" but no longer contains it, so the exclusion is stale`,
      ).toBe(true);
    }
  });

  it("keeps every tell out of email templates and generated documents", () => {
    const excluded = new Set(EXCLUSIONS.map((e) => `${e.file}: ${e.word}`));
    const hits: string[] = [];
    for (const file of VISITOR_SURFACES.flatMap(filesUnder)) {
      const rel = file.slice(REPO_ROOT.length + 1);
      const src = stripTsComments(readFileSync(file, "utf8"));
      for (const tell of TELLS) {
        const re = new RegExp(`\\b${tell.replace(/ /g, "\\s+")}\\b`, "i");
        if (re.test(src) && !excluded.has(`${rel}: ${tell}`)) {
          hits.push(`${rel}: ${tell}`);
        }
      }
    }
    expect(
      hits,
      "section 6.6: a word on this list in an email subject, a PDF footer or " +
        "a page title tells the prospect they are in a sandbox, and a " +
        "prospect who works that out is the third of the three failures the " +
        "contract names",
    ).toEqual([]);
  });

  it("keeps every tell out of export filenames", () => {
    // Section 6.6 names export filenames specifically. There are two
    // download names in this product and both are constructed from a literal
    // template, so both are readable statically.
    const names = [
      {
        file: "app/api/export/data/route.ts",
        re: /const filename = `([^`]*)`/,
      },
      {
        file: "components/calculators/MileageLogBuilder.tsx",
        re: /a\.download = `([^`]*)`/,
      },
    ];
    for (const { file, re } of names) {
      const src = readFileSync(join(REPO_ROOT, file), "utf8");
      const m = src.match(re);
      expect(m, `${file}: export filename template moved or was renamed`).not.toBeNull();
      for (const tell of TELLS) {
        expect(
          new RegExp(`\\b${tell}\\b`, "i").test(m![1]),
          `${file}: export filename contains "${tell}"`,
        ).toBe(false);
      }
    }
  });

  it("keeps every tell out of the seed fixture itself", () => {
    // The fixture is the copy the prospect reads first. A category called
    // "sample" or a company called "Demo Co" would give the whole thing away
    // on the first screen.
    const text = JSON.stringify(SANDBOX_SEED);
    for (const tell of TELLS) {
      expect(
        new RegExp(`\\b${tell}\\b`, "i").test(text),
        `the sandbox seed contains "${tell}"`,
      ).toBe(false);
    }
  });
});
