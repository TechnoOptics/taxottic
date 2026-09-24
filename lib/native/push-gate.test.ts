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
  it("never prompts when the flag is disabled, even when both gates are open", () => {
    expect(pushDecision({ hasSession: true, reachedToday: true, receive: "prompt", pushEnabled: false })).toEqual({ prompt: false, register: false, report: "flag_disabled" });
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
  it("is wired: Today is marked in every branch the dashboard returns", () => {
    // The page returns three ways: the W-2 filer's PersonalDashboard, the
    // no-company empty state, and the owner dashboard. A marker only in
    // the last one leaves the other two able to reach Today without ever
    // opening the push gate, so those installs are never asked.
    const dash = readFileSync("app/dashboard/page.tsx", "utf8");
    const marks = dash.match(/<MarkReachedToday \/>/g) ?? [];
    expect(
      marks.length,
      "one for the W-2 return, one for the no-company empty state, one for the owner dashboard",
    ).toBe(3);
  });
  it("is wired: the Today listener is armed before the first gate run and torn down", () => {
    const init = readFileSync("components/CapacitorNativeInit.tsx", "utf8").replace(/\/\/.*$/gm, "");
    const listen = init.indexOf("addEventListener(REACHED_TODAY_EVENT");
    const firstRun = init.indexOf("await runPushGate()");
    expect(listen, "the listener is registered").toBeGreaterThan(-1);
    expect(
      firstRun,
      "the listener is armed before the first run, so a Today reached while the gate is awaiting the session is not dropped",
    ).toBeGreaterThan(listen);
    expect(init, "the listener is removed on unmount").toMatch(
      /removeEventListener\(REACHED_TODAY_EVENT/,
    );
  });
});
