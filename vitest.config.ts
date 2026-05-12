import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Vitest config for Taxottic.
 *
 * Scope: pure-TypeScript tax-engine + credit-module + state-bracket
 * tests. We deliberately don't run the Next.js / Supabase / React
 * surfaces here - those need integration testing with a real database
 * and a browser, and are a separate setup. The tax math, by contrast,
 * is a pure deterministic computation: same input → same output, no
 * I/O, no side effects. That's exactly the surface that benefits most
 * from fast unit tests against IRS-published worked examples.
 *
 * Path alias `@/` maps to the repo root so test files can import
 * production code the same way the app does.
 */
export default defineConfig({
  test: {
    // Default Vitest globs find anything named *.test.ts under any
    // directory. We add an explicit include for clarity.
    include: ["lib/**/*.test.ts"],
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
