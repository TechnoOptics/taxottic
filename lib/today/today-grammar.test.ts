import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the dashboard is Today", () => {
  const page = strip(readFileSync("app/dashboard/page.tsx", "utf8"));
  it("composes Today in the spec's order and never greets", () => {
    const order = ["<TodayHeader", "<TodaySpine", "<NextPaymentPanel", "<NeedsYourCall", "<ThisWeek", "<YearToDate"].map((t) => page.indexOf(t));
    expect(order.every((i) => i >= 0), "every Today section is rendered").toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(page).not.toMatch(/buildGreeting|greeting\.head|greeting\.pleasantry/);
    expect(page).not.toMatch(/<OutstandingTasksBanner|<OutstandingTasksPopup/);
    expect(page).toMatch(/data-grammar="year"/);
  });
  it("keeps the retired primitives out of the Today components", () => {
    for (const f of readdirSync("components/today").filter((f) => f.endsWith(".tsx") && !f.includes(".ct."))) {
      const src = strip(readFileSync(`components/today/${f}`, "utf8"));
      expect(src, f).not.toMatch(/kicker|gold-shine|text-gold-|bg-gold-|border-gold-|italic|rounded-full/);
      expect(src, f).not.toMatch(/\b(calmer|gentle|gently|quietly|friendly|scary)\b/i);
    }
  });
});
