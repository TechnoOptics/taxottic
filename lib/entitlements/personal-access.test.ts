import { describe, it, expect } from "vitest";
import { isPersonalLocked } from "./personal-access";

describe("isPersonalLocked", () => {
  it("solo user with no company is never locked", () => {
    expect(isPersonalLocked({ roles: [], plan: "free", status: "active" })).toBe(false);
    expect(isPersonalLocked({ roles: [], plan: null, status: null })).toBe(false);
  });

  it("owner/manager keeps personal even on free plan", () => {
    expect(isPersonalLocked({ roles: ["manager"], plan: "free", status: "active" })).toBe(false);
    expect(isPersonalLocked({ roles: ["lead"], plan: null, status: null })).toBe(false);
  });

  it("manager of one company + member of another still keeps personal", () => {
    expect(isPersonalLocked({ roles: ["member", "manager"], plan: "free", status: "active" })).toBe(false);
  });

  it("employee-only on an auto trial is LOCKED", () => {
    expect(isPersonalLocked({ roles: ["member"], plan: "solo", status: "trialing" })).toBe(true);
  });

  it("employee-only with no subscription is LOCKED", () => {
    expect(isPersonalLocked({ roles: ["expenser"], plan: null, status: null })).toBe(true);
  });

  it("employee-only who bought their own paid plan is unlocked", () => {
    expect(isPersonalLocked({ roles: ["member"], plan: "solo", status: "active" })).toBe(false);
    expect(isPersonalLocked({ roles: ["member"], plan: "filer", status: "active" })).toBe(false);
  });

  it("employee-only whose paid plan lapsed (canceled) is locked again", () => {
    expect(isPersonalLocked({ roles: ["member"], plan: "solo", status: "canceled" })).toBe(true);
    expect(isPersonalLocked({ roles: ["member"], plan: "free", status: "active" })).toBe(true);
  });
});
