import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The spine is on the page, in the fixed header, and the motion is wired to it. */
const ROOT = join(__dirname, "..", "..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const page = strip(readFileSync(join(ROOT, "app/page.tsx"), "utf8"));

describe("the year spine on the home page", () => {
  it("is passed to the header's spine slot with the fixed sample date", () => {
    expect(page).toMatch(/spine=\{\s*<YearSpine\b[^>]*variant="paper"/);
    expect(page).toMatch(/<YearSpine\b[^>]*id="year-spine"/);
    expect(page).toMatch(/asOf=\{HOME_AS_OF\}/);
  });

  it("wires the motion to that spine", () => {
    expect(page).toMatch(/<YearSpineMotion\b[^>]*spineId="year-spine"/);
  });
});
