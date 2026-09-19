import { describe, expect, it } from "vitest";
import { activeCompanyFirst, tabBarLinks } from "./tab-bar";

describe("tab bar routes", () => {
  it("routes money and forecast to the company when the stored mode is business", () => {
    const links = tabBarLinks({ companies: [{ public_id: "abc", role: "manager" }], storedMode: "business", pathname: "/mileage" });
    expect(links.map((l) => [l.key, l.href, l.current])).toEqual([
      ["today", "/dashboard", false],
      ["drives", "/mileage", true],
      ["money", "/c/abc/expenses", false],
      ["forecast", "/c/abc/forecast", false],
    ]);
  });
  it("routes to the personal hub when the mode is personal or there is no company", () => {
    expect(tabBarLinks({ companies: [], storedMode: null, pathname: "/dashboard" }).map((l) => l.href)).toEqual(["/dashboard", "/mileage", "/personal/expenses", "/personal/forecast"]);
    expect(tabBarLinks({ companies: [{ public_id: "abc", role: "manager" }], storedMode: "personal", pathname: "/personal/forecast" }).find((l) => l.key === "forecast")).toMatchObject({ href: "/personal/forecast", current: true });
  });
  it("follows the active company, not the first one the user joined", () => {
    // A user who works at someone else's company and owns their own: the
    // membership they joined first is the one that is not theirs.
    const memberships = [
      { id: "c-employer", public_id: "zzz", role: "member" },
      { id: "c-own", public_id: "abc", role: "manager" },
    ];
    const active = tabBarLinks({ companies: activeCompanyFirst(memberships, "c-own"), storedMode: "business", pathname: "/dashboard" });
    expect(active.find((l) => l.key === "money")?.href).toBe("/c/abc/expenses");
    expect(active.find((l) => l.key === "forecast")?.href).toBe("/c/abc/forecast");
    // No stored active company, or one the user no longer belongs to,
    // falls back to the first membership rather than guessing.
    for (const stale of [null, "c-left"]) {
      const fallback = tabBarLinks({ companies: activeCompanyFirst(memberships, stale), storedMode: "business", pathname: "/dashboard" });
      expect(fallback.find((l) => l.key === "money")?.href).toBe("/c/zzz/expenses");
    }
  });
  it("marks the current tab by path prefix", () => {
    const links = tabBarLinks({ companies: [{ public_id: "abc", role: "manager" }], storedMode: "business", pathname: "/c/abc/expenses/new" });
    expect(links.find((l) => l.key === "money")?.current).toBe(true);
  });
  it("marks Drives current on a mileage sub-route", () => {
    const links = tabBarLinks({ companies: [{ public_id: "abc", role: "manager" }], storedMode: "business", pathname: "/mileage/classify" });
    expect(links.find((l) => l.key === "drives")?.current).toBe(true);
  });
});
