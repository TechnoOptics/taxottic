import { describe, it, expect } from "vitest";
import { deriveSlugCandidate, isValidSlugFormat } from "./slug";

describe("deriveSlugCandidate", () => {
  it("normalizes spaces and casing", () => {
    expect(deriveSlugCandidate("Smith Allen CPA")).toBe("smith-allen-cpa");
  });

  it("expands ampersand to 'and' and strips 'and'", () => {
    expect(deriveSlugCandidate("Smith & Allen CPA")).toBe("smith-allen-cpa");
  });

  it("strips stop-words (and, the, of)", () => {
    expect(deriveSlugCandidate("The Best of Smith")).toBe("best-smith");
  });

  it("keeps firm-signal suffixes (cpa, llp, etc.)", () => {
    expect(deriveSlugCandidate("Jefferson Tax LLP")).toBe("jefferson-tax-llp");
  });

  it("returns empty for non-Latin input (forces operator override)", () => {
    expect(deriveSlugCandidate("회사")).toBe("");
  });

  it("pads short slugs to clear the minimum length", () => {
    expect(deriveSlugCandidate("AC")).toBe("ac-firm");
  });

  it("truncates long slugs to 32 chars and avoids trailing hyphen", () => {
    const out = deriveSlugCandidate(
      "Hamilton Madison Jefferson Adams CPA Firm Group",
    );
    expect(out.length).toBeLessThanOrEqual(32);
    expect(out.endsWith("-")).toBe(false);
  });
});

describe("isValidSlugFormat", () => {
  it("accepts a typical slug", () => {
    expect(isValidSlugFormat("smith-allen-cpa")).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(isValidSlugFormat("SmithAllen")).toBe(false);
  });

  it("rejects leading or trailing hyphen", () => {
    expect(isValidSlugFormat("-smith")).toBe(false);
    expect(isValidSlugFormat("smith-")).toBe(false);
  });

  it("rejects too-short and too-long", () => {
    expect(isValidSlugFormat("ab")).toBe(false);
    expect(isValidSlugFormat("a".repeat(33))).toBe(false);
  });

  it("rejects reserved subdomains", () => {
    expect(isValidSlugFormat("admin")).toBe(false);
    expect(isValidSlugFormat("www")).toBe(false);
    expect(isValidSlugFormat("api")).toBe(false);
    expect(isValidSlugFormat("hq")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidSlugFormat("")).toBe(false);
  });
});
