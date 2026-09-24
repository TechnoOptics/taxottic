/**
 * The seed is synthetic, checked in, and identical for every prospect.
 *
 * Fleet contract section 6.4. Three properties are asserted, because all
 * three are things a well-meaning change would quietly break:
 *
 *   synthetic   the module reads no database and imports nothing that could
 *   fixed       no clock, no randomness, no per-prospect variation
 *   applicable  every column it names still exists in the migrations
 *
 * The third is this repo's own recurring bug class, not a contract
 * requirement. A PostgREST insert naming a column that does not exist comes
 * back `{data: null, error: {code: "42703"}}` rather than throwing, and the
 * money paths here destructure `data` and ignore `error` (see
 * lib/db/schema-contract.test.ts, which exists because that silently
 * mis-projected a year of deductions). A seed that fails that way would open
 * an empty product for the prospect and report success to the Hub.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { columnsByTable } from "./catalog";
import { SANDBOX_SEED, SEED_TAX_YEAR } from "./sandbox-seed";

const SOURCE = readFileSync(join(__dirname, "sandbox-seed.ts"), "utf8");

/** Strip comments so the prose above cannot satisfy or trip any assertion. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("the seed is synthetic and checked in", () => {
  it("imports nothing", () => {
    // The whole guarantee rests on this. A single import of a Supabase
    // client, an fs read, or a faker would turn "written by your team,
    // checked into your repository" into something else.
    expect(CODE).not.toMatch(/\bimport\b/);
    expect(CODE).not.toMatch(/\brequire\s*\(/);
  });

  it("has no clock and no randomness", () => {
    // "Identical for every prospect" is a wire-visible property: two
    // prospects comparing screens is a normal thing for a buying committee
    // to do, and it is also what makes the fixture reviewable at all.
    for (const forbidden of [/Math\.random/, /\bnew Date\b/, /Date\.now/, /crypto\./]) {
      expect(CODE).not.toMatch(forbidden);
    }
    expect(SEED_TAX_YEAR).toBe(2026);
  });

  it("carries enough content to be worth opening", () => {
    // A sandbox that opens onto an empty product demonstrates nothing, which
    // is the reason 6.4 permits a seed at all.
    expect(SANDBOX_SEED.monthly_income.length).toBeGreaterThanOrEqual(6);
    expect(SANDBOX_SEED.monthly_expenses.length).toBeGreaterThanOrEqual(10);
    expect(SANDBOX_SEED.mileage_trips.length).toBeGreaterThanOrEqual(3);
  });

  it("uses relative offsets for drives, not absolute timestamps", () => {
    // A fixed timestamp would show the prospect drives from whenever this
    // file was last edited. Section 6.6's "timing" tell, in a different
    // costume.
    for (const trip of SANDBOX_SEED.mileage_trips) {
      expect(trip.started_at_offset_minutes).toBeLessThan(0);
      expect(Number.isInteger(trip.started_at_offset_minutes)).toBe(true);
    }
  });
});

describe("every column the seed names exists in the migrations", () => {
  const schema = columnsByTable();

  const expectColumns = (table: string, columns: string[]) => {
    const known = schema.get(table);
    expect(known, `${table} is not defined by any migration`).toBeDefined();
    const missing = columns.filter((c) => !known!.has(c));
    expect(missing, `${table}: seed names columns the schema does not have`).toEqual(
      [],
    );
  };

  it("derives non-empty column sets for the tables the seed writes", () => {
    for (const t of ["companies", "monthly_income", "monthly_expenses", "mileage_trips"]) {
      expect(schema.get(t)?.size ?? 0, t).toBeGreaterThan(5);
    }
  });

  it("matches companies", () => {
    expectColumns("companies", Object.keys(SANDBOX_SEED.company));
  });

  it("matches monthly_income", () => {
    expectColumns("monthly_income", Object.keys(SANDBOX_SEED.monthly_income[0]));
  });

  it("matches monthly_expenses", () => {
    expectColumns("monthly_expenses", Object.keys(SANDBOX_SEED.monthly_expenses[0]));
  });

  it("matches mileage_trips, once the offsets are resolved", () => {
    // started_at_offset_minutes and duration_minutes are fixture-only: the
    // provisioning code turns them into started_at and ended_at. Everything
    // else is written straight through and must exist.
    const passthrough = Object.keys(SANDBOX_SEED.mileage_trips[0]).filter(
      (k) => !k.endsWith("_offset_minutes") && k !== "duration_minutes",
    );
    expectColumns("mileage_trips", passthrough);
    for (const derived of ["started_at", "ended_at"]) {
      expect([...schema.get("mileage_trips")!]).toContain(derived);
    }
  });
});
