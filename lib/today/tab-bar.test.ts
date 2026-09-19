import { describe, expect, it } from "vitest";
import { tabBarLinks } from "./tab-bar";

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
  it("marks the current tab by path prefix", () => {
    const links = tabBarLinks({ companies: [{ public_id: "abc", role: "manager" }], storedMode: "business", pathname: "/c/abc/expenses/new" });
    expect(links.find((l) => l.key === "money")?.current).toBe(true);
  });
  it("marks Drives current on a mileage sub-route", () => {
    const links = tabBarLinks({ companies: [{ public_id: "abc", role: "manager" }], storedMode: "business", pathname: "/mileage/classify" });
    expect(links.find((l) => l.key === "drives")?.current).toBe(true);
  });
});
