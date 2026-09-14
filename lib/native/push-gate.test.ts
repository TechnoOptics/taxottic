import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pushDecision } from "./push-gate";

const base = { hasSession: true, reachedToday: true, receive: "prompt" as const, pushEnabled: true };

describe("push gate", () => {
  it("never prompts before a session and a first visit to Today", () => {
    expect(pushDecision({ ...base, hasSession: false })).toEqual({ prompt: false, register: false, report: "gated_no_session" });
    expect(pushDecision({ ...base, reachedToday: false })).toEqual({ prompt: false, register: false, report: "gated_before_today" });
  });
  it("prompts once both gates are open and the OS can still ask", () => {
    expect(pushDecision(base)).toEqual({ prompt: true, register: false, report: "prompting" });
    expect(pushDecision({ ...base, receive: "prompt-with-rationale" }).prompt).toBe(true);
  });
  it("never asks again after a denial, and registers only when granted and enabled", () => {
    expect(pushDecision({ ...base, receive: "denied" })).toEqual({ prompt: false, register: false, report: "permission_denied" });
    expect(pushDecision({ ...base, receive: "granted" })).toEqual({ prompt: false, register: true, report: "register_called" });
    expect(pushDecision({ ...base, receive: "granted", pushEnabled: false })).toEqual({ prompt: false, register: false, report: "flag_disabled" });
  });
  it("is wired: the init decides before it prompts, and Today marks itself", () => {
    const init = readFileSync("components/CapacitorNativeInit.tsx", "utf8").replace(/\/\/.*$/gm, "");
    const decide = init.indexOf("pushDecision(");
    const prompt = init.indexOf("requestPermissions()");
    expect(decide).toBeGreaterThan(-1);
    expect(prompt).toBeGreaterThan(decide);
    expect(init).toMatch(/if \(decision\.prompt\)/);
    expect(init).toMatch(/if \(decision\.register\)/);
    expect(init).toMatch(/addEventListener\(REACHED_TODAY_EVENT/);
    expect(readFileSync("app/dashboard/page.tsx", "utf8")).toMatch(/<MarkReachedToday \/>/);
  });
});
