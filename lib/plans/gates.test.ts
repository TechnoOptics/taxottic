import { describe, it, expect } from "vitest";
import { FEATURE_GATES, type FeatureGates, type Plan } from "./limits";

/**
 * Guards the plan → feature matrix (the audit's "features must match the
 * plan" gap). Two invariants together fully pin the matrix to business
 * intent, so any accidental edit to FEATURE_GATES fails loudly with the
 * offending feature named:
 *
 *   1. MONOTONICITY, once a feature unlocks at some tier, every higher
 *      tier keeps it (you can never pay MORE and lose a capability).
 *   2. UNLOCK POINT, each feature turns on at exactly its intended tier.
 *
 * Adding a new gate to FeatureGates without recording its unlock tier in
 * UNLOCKS_AT below fails the "no untracked gates" test, so new features
 * can't ship with an unreviewed pricing decision.
 */

// Cheapest → most premium. The whole matrix is validated along this order.
const LADDER: Plan[] = ["free", "filer", "solo", "studio", "scale", "practice"];

// The intended first tier at which each feature is available.
const UNLOCKS_AT: Record<keyof FeatureGates, Plan> = {
  personalForecast: "filer",
  bella: "filer",
  taxPreparer: "filer",
  businessForecast: "solo",
  bankConnect: "solo",
  csvImport: "solo",
  csvBulk: "studio",
  teamChat: "studio",
  inviteEmployees: "studio",
  multiCompany: "studio",
  multiState: "studio",
  prioritySupport: "scale",
  auditSupport: "scale",
  whiteLabel: "scale",
  apiAccess: "scale",
  preparerCenter: "practice",
};

const ALL_FEATURES = Object.keys(UNLOCKS_AT) as (keyof FeatureGates)[];

describe("plan feature-gate matrix", () => {
  it("defines exactly the ladder's plans", () => {
    expect(Object.keys(FEATURE_GATES).sort()).toEqual([...LADDER].sort());
  });

  it("free unlocks nothing", () => {
    for (const f of ALL_FEATURES) {
      expect(FEATURE_GATES.free[f], `free must not unlock ${f}`).toBe(false);
    }
  });

  it("has no untracked gates (UNLOCKS_AT covers every FeatureGates key)", () => {
    // FEATURE_GATES.practice enables everything, so its keys == the full set.
    expect(
      Object.keys(UNLOCKS_AT).sort(),
      "A gate in FeatureGates has no intended unlock tier, add it to UNLOCKS_AT (a pricing decision).",
    ).toEqual(Object.keys(FEATURE_GATES.practice).sort());
  });

  it("is monotonic, a feature never turns OFF at a higher tier", () => {
    for (const f of ALL_FEATURES) {
      let unlocked = false;
      for (const plan of LADDER) {
        const on = FEATURE_GATES[plan][f];
        if (on) unlocked = true;
        if (unlocked) {
          expect(on, `${f} regressed to false at "${plan}" after unlocking earlier`).toBe(true);
        }
      }
    }
  });

  it("unlocks each feature at exactly its intended tier", () => {
    for (const f of ALL_FEATURES) {
      const unlockIdx = LADDER.indexOf(UNLOCKS_AT[f]);
      LADDER.forEach((plan, i) => {
        const expected = i >= unlockIdx;
        expect(
          FEATURE_GATES[plan][f],
          `${f} @ ${plan}: expected ${expected} (unlocks at "${UNLOCKS_AT[f]}")`,
        ).toBe(expected);
      });
    }
  });
});
