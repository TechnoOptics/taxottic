import { describe, it, expect } from "vitest";
import { isVersionBelow, MIN_SUPPORTED_NATIVE_VERSION } from "./compare";

describe("isVersionBelow", () => {
  it("older major/minor/patch is below", () => {
    expect(isVersionBelow("1.0", "1.2.0")).toBe(true);
    expect(isVersionBelow("1.0.0", "1.2.0")).toBe(true);
    expect(isVersionBelow("1.1.9", "1.2.0")).toBe(true);
    expect(isVersionBelow("0.9.0", "1.2.0")).toBe(true);
  });

  it("equal is NOT below", () => {
    expect(isVersionBelow("1.2.0", "1.2.0")).toBe(false);
    expect(isVersionBelow("1.2", "1.2.0")).toBe(false); // missing seg(s) = 0
  });

  it("newer is NOT below", () => {
    expect(isVersionBelow("1.2.1", "1.2.0")).toBe(false);
    expect(isVersionBelow("1.3.0", "1.2.0")).toBe(false);
    expect(isVersionBelow("2.0.0", "1.2.0")).toBe(false);
  });

  it("unreadable/missing versions never nag (fail-open)", () => {
    expect(isVersionBelow(null, "1.2.0")).toBe(false);
    expect(isVersionBelow(undefined, "1.2.0")).toBe(false);
    expect(isVersionBelow("", "1.2.0")).toBe(false);
    expect(isVersionBelow("web", "1.2.0")).toBe(false);
    expect(isVersionBelow("v-unknown", "1.2.0")).toBe(false);
  });

  it("ignores non-numeric suffixes on a segment", () => {
    expect(isVersionBelow("1.2.0-rc1", "1.2.0")).toBe(false);
    expect(isVersionBelow("1.1.0-beta", "1.2.0")).toBe(true);
  });

  it("multi-digit segments compare numerically, not lexically", () => {
    expect(isVersionBelow("1.10.0", "1.9.0")).toBe(false); // 10 > 9
    expect(isVersionBelow("1.9.0", "1.10.0")).toBe(true);
  });

  it("the shipped floor is self-consistent", () => {
    expect(isVersionBelow(MIN_SUPPORTED_NATIVE_VERSION, MIN_SUPPORTED_NATIVE_VERSION)).toBe(
      false,
    );
    expect(isVersionBelow("1.0", MIN_SUPPORTED_NATIVE_VERSION)).toBe(true);
  });
});
