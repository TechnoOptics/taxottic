import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Vitest config for Taxottic.
 *
 * Scope: pure-TypeScript tax-engine + credit-module + state-bracket
 * tests, plus a small set of standalone CI-guard scripts that are also
 * pure functions with no I/O. We deliberately don't run the Next.js /
 * Supabase / React surfaces here - those need integration testing with
 * a real database and a browser, and are a separate setup. The tax
 * math, by contrast, is a pure deterministic computation: same input
 * gives same output, no I/O, no side effects. That's exactly the
 * surface that benefits most from fast unit tests against
 * IRS-published worked examples.
 *
 * Path alias `@/` maps to the repo root so test files can import
 * production code the same way the app does.
 */
export default defineConfig({
  test: {
    // Default Vitest globs find anything named *.test.ts under any
    // directory. We add an explicit include for clarity, plus the CI guard
    // tests under scripts/ (those guards have no npm dependencies, so they
    // are plain .mjs rather than .ts).
    //
    // The scripts entry is a GLOB on purpose. It used to name
    // check-migration-order.test.mjs literally, so when a second guard test
    // was added it matched nothing and vitest reported "No test files
    // found" for it while the suite as a whole stayed green. A test that
    // silently never runs is worse than no test: it looks like coverage.
    //
    // `app/**` was missing from this list from the config's first commit
    // (311f8923, 2026-05-12) until 2026-09-22, roughly four months. No
    // test was actually lost to it, because this repo has never had a
    // test file under app/ until now (`git log --diff-filter=A --
    // 'app/**/*.test.ts'` returns exactly one). It was a trap rather than
    // a loss: the FIRST such test would have been dead on arrival, and
    // the usual gate spelling hides that, because vitest ORs its
    // positional filters and only errors when the whole set is empty. So
    // `npx vitest run lib/mileage app/api` reported 929 green with zero
    // app tests found, which is the exact "a guard that cannot see a
    // whole class reads as coverage" failure the scripts note above
    // describes.
    include: ["app/**/*.test.ts", "lib/**/*.test.ts", "scripts/**/*.test.mjs"],
    // Each test file runs in its own context but they share a single
    // Node process for speed. None of our tax-engine tests mutate
    // shared state, so this is safe.
    environment: "node",
    // Surface test names + assertion failures with full context;
    // makes a regression in a bracket boundary obvious.
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname),
    },
  },
});
