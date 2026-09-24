import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * EVERY TEST FILE IS ACTUALLY RUN.
 *
 * vitest.config.ts names its `include` patterns explicitly. `app/**` was
 * missing from that list from the config's first commit (2026-05-12)
 * until 2026-09-22, about four months, and nothing failed when it was
 * missing: vitest ORs its positional filters and only errors when the
 * WHOLE set is empty, so `npx vitest run lib/mileage app/api` reported
 * hundreds green with zero app tests found. Deleting the glob again
 * today drops the suite by the file that holds every access-control
 * assertion on the drives route, and still exits 0.
 *
 * A guard that cannot see a whole class of tests reads as coverage.
 * This one reads the config and the directory tree and holds them to
 * each other: every directory that contains a test file must be covered
 * by a pattern, whatever the pattern's spelling.
 *
 * It lives under scripts/ on purpose. The glob most likely to be deleted
 * is the one for the code under test (app, lib), and a guard living
 * there would be deleted with it.
 */

const ROOT = new URL("..", import.meta.url).pathname;

/** Directories no test should ever be looked for in. */
const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "test-results",
  "playwright-report",
  "coverage",
  "dist",
  "build",
  ".vercel",
  ".superpowers",
]);

/** What vitest considers a unit test file here. Playwright's own
 *  `*.ct.spec.tsx` and `e2e/*.spec.ts` are a different runner with its
 *  own config, and are deliberately not in this set. */
const TEST_FILE = /\.test\.(ts|tsx|mts|mjs|js)$/;

function testFiles(dir = ROOT, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".superpowers") {
      if (entry.isDirectory()) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      testFiles(full, out);
    } else if (TEST_FILE.test(entry.name)) {
      out.push(relative(ROOT, full).split(sep).join("/"));
    }
  }
  return out;
}

/** The `include` array, read out of the config as text. Reading the text
 *  rather than importing the module keeps this independent of whatever
 *  the config imports, and it is the text somebody edits. */
function includePatterns() {
  const src = readFileSync(join(ROOT, "vitest.config.ts"), "utf8");
  const at = src.indexOf("include:");
  expect(at, "vitest.config.ts has no include list").toBeGreaterThan(-1);
  const list = src.slice(at, src.indexOf("]", at));
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * A glob, as a regex. Only the three constructs these patterns use:
 * `**` across directories, `*` within one segment, and literals.
 */
function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // `**/` matches any number of directories, including none.
      if (glob[i + 2] === "/") {
        out += "(?:[^/]+/)*";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "{") {
      out += "(?:";
    } else if (c === "}") {
      out += ")";
    } else if (c === ",") {
      out += "|";
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

describe("vitest runs every test file in the repo", () => {
  const patterns = includePatterns();
  const covered = patterns.map(globToRegExp);
  const files = testFiles();

  it("finds test files at all", () => {
    // Without this, a broken walker would make the assertion below pass
    // against an empty list, which is the failure this whole file exists
    // to stop happening again.
    expect(files.length).toBeGreaterThan(50);
  });

  it("covers every directory that holds a test file", () => {
    const orphans = files.filter((f) => !covered.some((re) => re.test(f)));
    expect(
      orphans,
      `no include pattern in vitest.config.ts matches these test files, ` +
        `so they never run and their absence fails nothing: ` +
        `${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("matches the globs it is given the way vitest does", () => {
    // The translator is the part of this guard that can be wrong without
    // saying so, so it is pinned directly.
    const re = globToRegExp("app/**/*.test.ts");
    expect(re.test("app/api/mileage/drives/route.test.ts")).toBe(true);
    expect(re.test("app/thing.test.ts")).toBe(true);
    expect(re.test("lib/thing.test.ts")).toBe(false);
    expect(re.test("app/api/route.test.mjs")).toBe(false);
  });
});
