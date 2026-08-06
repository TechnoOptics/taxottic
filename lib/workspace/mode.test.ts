import { describe, it, expect } from "vitest";
import {
  parseWorkspaceMode,
  resolveDashboardLanding,
  modeForPathname,
} from "./mode";

const ACME = { id: "co-1", publicId: "acme" };
const BETA = { id: "co-2", publicId: "beta" };

describe("parseWorkspaceMode", () => {
  it("accepts the two real modes", () => {
    expect(parseWorkspaceMode("personal")).toBe("personal");
    expect(parseWorkspaceMode("business")).toBe("business");
  });

  it("treats an absent value as 'never chosen'", () => {
    expect(parseWorkspaceMode(null)).toBeNull();
    expect(parseWorkspaceMode(undefined)).toBeNull();
    expect(parseWorkspaceMode("")).toBeNull();
  });

  it("treats an unrecognized value as 'never chosen' rather than throwing", () => {
    // A row written by a future version, or hand-edited, must degrade to
    // today's behavior instead of breaking the dashboard.
    expect(parseWorkspaceMode("Business")).toBeNull();
    expect(parseWorkspaceMode("firm")).toBeNull();
    expect(parseWorkspaceMode(7)).toBeNull();
    expect(parseWorkspaceMode({})).toBeNull();
  });
});

describe("resolveDashboardLanding", () => {
  it("does NOT redirect a user who has never chosen a mode", () => {
    // The whole point of the null default: existing users see no change.
    expect(
      resolveDashboardLanding({
        storedMode: null,
        companies: [ACME],
        activeCompanyId: ACME.id,
      }),
    ).toEqual({ redirectTo: null, clearStoredMode: false });
  });

  it("does NOT redirect when the remembered mode is personal", () => {
    // /dashboard already IS the personal hub, so personal is a no-op.
    expect(
      resolveDashboardLanding({
        storedMode: "personal",
        companies: [ACME],
        activeCompanyId: ACME.id,
      }),
    ).toEqual({ redirectTo: null, clearStoredMode: false });
  });

  it("restores business mode to the remembered active company", () => {
    expect(
      resolveDashboardLanding({
        storedMode: "business",
        companies: [ACME, BETA],
        activeCompanyId: BETA.id,
      }),
    ).toEqual({ redirectTo: "/c/beta/forecast", clearStoredMode: false });
  });

  it("falls back to the first membership when active_company_id is null", () => {
    expect(
      resolveDashboardLanding({
        storedMode: "business",
        companies: [ACME, BETA],
        activeCompanyId: null,
      }),
    ).toEqual({ redirectTo: "/c/acme/forecast", clearStoredMode: false });
  });

  it("never trusts a stale active_company_id the user no longer belongs to", () => {
    // They were removed from BETA but the column still points at it.
    expect(
      resolveDashboardLanding({
        storedMode: "business",
        companies: [ACME],
        activeCompanyId: BETA.id,
      }),
    ).toEqual({ redirectTo: "/c/acme/forecast", clearStoredMode: false });
  });

  // The case that must never strand anyone.
  it("does NOT redirect a user who has no business at all, and clears the stale mode", () => {
    expect(
      resolveDashboardLanding({
        storedMode: "business",
        companies: [],
        activeCompanyId: null,
      }),
    ).toEqual({ redirectTo: null, clearStoredMode: true });
  });

  it("does not strand a user whose last company was deleted or left", () => {
    // Stored business + a dangling active_company_id + zero memberships is
    // exactly the shape left behind when the user's only company goes away.
    expect(
      resolveDashboardLanding({
        storedMode: "business",
        companies: [],
        activeCompanyId: ACME.id,
      }),
    ).toEqual({ redirectTo: null, clearStoredMode: true });
  });

  it("does not ask for a clear when there was nothing stored to clear", () => {
    expect(
      resolveDashboardLanding({
        storedMode: null,
        companies: [],
        activeCompanyId: null,
      }),
    ).toEqual({ redirectTo: null, clearStoredMode: false });
    expect(
      resolveDashboardLanding({
        storedMode: "personal",
        companies: [],
        activeCompanyId: null,
      }),
    ).toEqual({ redirectTo: null, clearStoredMode: false });
  });
});

describe("modeForPathname", () => {
  it("reads the business surfaces as business mode", () => {
    expect(modeForPathname("/c/acme/forecast")).toBe("business");
    expect(modeForPathname("/c/acme/expenses")).toBe("business");
    expect(modeForPathname("/mileage")).toBe("business");
    expect(modeForPathname("/mileage/classify")).toBe("business");
  });

  it("reads the personal hub as personal mode", () => {
    expect(modeForPathname("/personal/forecast")).toBe("personal");
    expect(modeForPathname("/personal/playbook")).toBe("personal");
    expect(modeForPathname("/personal/upgrade")).toBe("personal");
  });

  it("treats /dashboard as ambiguous so it never overwrites the stored mode", () => {
    // /dashboard is the route the restore exists to fix. If it counted as a
    // mode signal it would immediately clobber a remembered "business".
    expect(modeForPathname("/dashboard")).toBeNull();
  });

  it("treats shared, mode-neutral routes as ambiguous", () => {
    for (const p of ["/goals", "/settings", "/billing", "/reminders", "/"]) {
      expect(modeForPathname(p)).toBeNull();
    }
  });

  it("is not fooled by prefixes that merely start with a mode segment", () => {
    expect(modeForPathname("/companies/new")).toBeNull();
    expect(modeForPathname("/calculators")).toBeNull();
    expect(modeForPathname(null)).toBeNull();
  });
});
