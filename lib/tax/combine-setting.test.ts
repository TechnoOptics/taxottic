import { describe, it, expect } from "vitest";
import { resolveCombine } from "./combine-setting";

describe("resolveCombine", () => {
  it("honors an explicit opt-in regardless of entity type", () => {
    expect(resolveCombine(true, "c_corp")).toBe(true);
    expect(resolveCombine(true, "sole_prop")).toBe(true);
  });

  it("honors an explicit opt-out regardless of entity type", () => {
    expect(resolveCombine(false, "sole_prop")).toBe(false);
    expect(resolveCombine(false, "s_corp")).toBe(false);
  });

  it("defaults a C-corp to SEPARATE when no preference is set", () => {
    expect(resolveCombine(null, "c_corp")).toBe(false);
    expect(resolveCombine(undefined, "c_corp")).toBe(false);
  });

  it("defaults every pass-through to COMBINED when no preference is set", () => {
    for (const e of [
      "sole_prop",
      "single_llc",
      "multi_llc",
      "s_corp",
      "partnership",
      "self_employed_1099",
    ]) {
      expect(resolveCombine(null, e)).toBe(true);
    }
  });

  it("defaults to COMBINED when the entity type is also unknown (legacy behavior)", () => {
    expect(resolveCombine(null, null)).toBe(true);
    expect(resolveCombine(undefined, undefined)).toBe(true);
    expect(resolveCombine(null, "")).toBe(true);
  });
});
