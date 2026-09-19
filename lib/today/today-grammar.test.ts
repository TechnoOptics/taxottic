import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

/** Spec 4.3, in order. */
const TAGS = ["<TodayHeader", "<TodaySpine", "<NextPaymentPanel", "<NeedsYourCall", "<ThisWeek", "<YearToDate"];

/**
 * One entry per section root carrying `data-grammar="year"`, each holding
 * that section's text only: from its own mark to the next one, or to the
 * end of the file.
 *
 * Searching the whole page instead would let one branch's composition
 * stand in for the other's, because indexOf stops at the first hit: the
 * company branch comes first in the file, so every tag was already found
 * before the personal-only branch was ever read, and deleting a section
 * from that branch passed.
 */
function todaySections(page: string) {
  const marks = [...page.matchAll(/data-grammar="year"/g)].map((m) => m.index ?? -1);
  return marks.map((start, i) => {
    const text = page.slice(start, marks[i + 1] ?? page.length);
    const width = /max-w-(\w+)/.exec(text)?.[1];
    return { name: width ? `the max-w-${width} branch` : `the branch at index ${start}`, text };
  });
}

describe("the dashboard is Today", () => {
  const page = strip(readFileSync("app/dashboard/page.tsx", "utf8"));
  it("composes Today in the spec's order in every branch, and never greets", () => {
    const sections = todaySections(page);
    expect(sections.length, 'both Today branches carry data-grammar="year"').toBeGreaterThanOrEqual(2);
    for (const section of sections) {
      const order = TAGS.map((t) => section.text.indexOf(t));
      const missing = TAGS.filter((_, i) => order[i] < 0);
      expect(missing, `${section.name} is missing ${missing.join(", ")}`).toEqual([]);
      expect([...order].sort((a, b) => a - b), `${section.name} composes Today out of the spec's order`).toEqual(order);
    }
    expect(page).not.toMatch(/buildGreeting|greeting\.head|greeting\.pleasantry/);
    expect(page).not.toMatch(/<OutstandingTasksBanner|<OutstandingTasksPopup/);
  });
  it("keeps the retired primitives out of the Today components", () => {
    for (const f of readdirSync("components/today").filter((f) => f.endsWith(".tsx") && !f.includes(".ct."))) {
      const src = strip(readFileSync(`components/today/${f}`, "utf8"));
      expect(src, f).not.toMatch(/kicker|gold-shine|text-gold-|bg-gold-|border-gold-|italic|rounded-full/);
      expect(src, f).not.toMatch(/\b(calmer|gentle|gently|quietly|friendly|scary)\b/i);
    }
  });
});
