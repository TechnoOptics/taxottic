import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("the rail is quiet", () => {
  it("uses no gold utility and no tracked eyebrow", () => {
    const src = readFileSync("components/LeftRail.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/text-gold-|bg-gold-|border-gold-|ring-gold-/);
    expect(src).not.toMatch(/tracking-\[0\.(2|28|32)em\]/);
  });
});
