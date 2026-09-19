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
  /**
   * Freshness is the one thing on Today that a stale page cannot admit to
   * on its own: every other figure looks the same whether it was synced a
   * minute or a month ago. The company branch has a bank feed and must
   * pass its last sync; the personal-only branch has none, so it must not
   * invent one.
   */
  it("tells the owner how fresh the bank data is, and claims nothing on the personal hub", () => {
    const sections = todaySections(page);
    const company = sections.find((s) => s.name.includes("max-w-5xl"));
    const personal = sections.find((s) => s.name.includes("max-w-3xl"));
    expect(company?.text, "the company branch must pass syncedAt to TodayHeader").toMatch(/<TodayHeader[^>]*syncedAt=/);
    expect(personal?.text, "the personal-only branch has no bank feed, so no syncedAt").not.toMatch(/<TodayHeader[^>]*syncedAt=/);
  });

  /**
   * The week's income comes from the bank feed, and the feed carries rows
   * the user dismissed and rows already written through to a
   * monthly_expenses row. Counting either one puts money in the ledger
   * twice or puts money there that never moved.
   */
  it("reads only applied, un-written-through transactions for the week", () => {
    const read = /\.from\("account_transactions"\)[\s\S]*?\.limit\(/.exec(page)?.[0];
    expect(read, 'no account_transactions read found').toBeTruthy();
    expect(read, "the week's bank read must be applied rows only").toMatch(/\.eq\("user_action",\s*"applied"\)/);
    expect(read, "a transaction already written to an expense is counted there, not here").toMatch(/\.is\("applied_to_expense_id",\s*null\)/);
  });

  /**
   * The owner's week and year are their company's books; a plain member's
   * are their own. Scoping is what keeps one user's business numbers off
   * the other's personal hub.
   */
  it("scopes Today's expense reads to the company the owner manages", () => {
    // Today's reads are the batch between managedCompanyId and the
    // personal forecast it feeds; the combined-1040 batch further down has
    // its own company scoping already.
    const from = page.indexOf("const managedCompanyId");
    const to = page.indexOf("const personalForecast");
    expect(from, "could not find Today's read batch").toBeGreaterThan(-1);
    expect(to, "could not find the end of Today's read batch").toBeGreaterThan(from);
    const todayReads = page.slice(from, to);
    const reads = todayReads.split('.from("monthly_expenses")').slice(1);
    expect(reads.length, "expected Today's week and year reads from monthly_expenses").toBe(2);
    for (const read of reads) {
      const clause = read.slice(0, read.indexOf(".limit("));
      expect(clause, "a Today expense read that is not scoped to the managed company").toMatch(/\.eq\("company_id",\s*managedCompanyId\)/);
    }
    expect(todayReads, "the personal-only branch reads personal_expenses instead").toMatch(/\.from\("personal_expenses"\)/);
    expect(todayReads, "a plain member has no company drives to show").toMatch(/managedCompanyId[\s\S]{0,200}\.from\("mileage_trips"\)/);
  });

  it("keeps the retired primitives out of the Today components", () => {
    for (const f of readdirSync("components/today").filter((f) => f.endsWith(".tsx") && !f.includes(".ct."))) {
      const src = strip(readFileSync(`components/today/${f}`, "utf8"));
      expect(src, f).not.toMatch(/kicker|gold-shine|text-gold-|bg-gold-|border-gold-|italic|rounded-full/);
      expect(src, f).not.toMatch(/\b(calmer|gentle|gently|quietly|friendly|scary)\b/i);
    }
  });
});
