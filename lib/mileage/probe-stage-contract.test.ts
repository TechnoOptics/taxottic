import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The client's probe stages and the server's allowlist must agree.
 *
 * The heartbeat route stores the stage with:
 *
 *     const oneOf = (k, allowed) => { const v = str(k, 12);
 *                                     return v && allowed.has(v) ? v : null; }
 *
 * Two independent ways for new instrumentation to report nothing at all
 * while looking perfectly wired at every other layer:
 *
 *   1. a stage the allowlist omits          -> rejected to NULL
 *   2. a stage longer than 12 characters    -> truncated, then rejected
 *
 * Both fail silently, in a column whose entire job is to explain a
 * silence. That is not theoretical: writing this instrumentation I named
 * a stage "bridge_native", which is thirteen characters, and it would
 * have shipped as a permanent NULL and been read as "the probe never got
 * that far".
 *
 * It is also the exact shape of the bug that took the heartbeat off the
 * air for a day: a payload field the storage layer would not accept, with
 * no error surfaced anywhere near the code that produced it.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const CLIENT = join(REPO_ROOT, "lib", "mileage", "device-status.ts");
const ROUTE = join(REPO_ROOT, "app", "api", "mileage", "heartbeat", "route.ts");

/** The string members of `export type DeviceProbeStage = ...`. */
function clientStages(): string[] {
  const src = readFileSync(CLIENT, "utf8");
  const start = src.indexOf("export type DeviceProbeStage");
  expect(start, "DeviceProbeStage not found — test is stale").toBeGreaterThan(-1);
  const end = src.indexOf(";", start);
  return [...src.slice(start, end).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** The members of STAGE_VALUES in the heartbeat route. */
function serverStages(): string[] {
  const src = readFileSync(ROUTE, "utf8");
  const start = src.indexOf("const STAGE_VALUES");
  expect(start, "STAGE_VALUES not found — test is stale").toBeGreaterThan(-1);
  const end = src.indexOf(");", start);
  return [...src.slice(start, end).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** The truncation width in the route's oneOf(), read rather than assumed. */
function stageMaxLength(): number {
  const src = readFileSync(ROUTE, "utf8");
  const m = src.match(/const oneOf =[\s\S]{0,200}?str\(k,\s*(\d+)\)/);
  expect(m, "oneOf truncation width not found — test is stale").toBeTruthy();
  return Number(m![1]);
}

describe("device probe stages survive the trip to the database", () => {
  const client = clientStages();
  const server = serverStages();

  it("finds stages on both sides", () => {
    // Guards the guard: a regex that stopped matching would make every
    // assertion below vacuous, which is the failure mode this repo keeps
    // rediscovering.
    expect(client.length).toBeGreaterThan(4);
    expect(server.length).toBeGreaterThan(4);
  });

  it("the server accepts every stage the client can send", () => {
    const rejected = client.filter((s) => !server.includes(s));
    expect(
      rejected,
      "These stages would be stored as NULL, so the instrumentation that " +
        "emits them would report nothing while appearing wired.",
    ).toEqual([]);
  });

  it("no stage is long enough to be truncated before the allowlist", () => {
    const max = stageMaxLength();
    const tooLong = [...new Set([...client, ...server])]
      .filter((s) => s.length > max)
      .map((s) => `${s} (${s.length} > ${max})`);
    expect(
      tooLong,
      "str(k, N) truncates BEFORE the allowlist check, so an over-long " +
        "stage is silently rejected to NULL.",
    ).toEqual([]);
  });

  it("the client defines no stage the server allows but nothing emits", () => {
    // The reverse direction is a weaker smell, but a server value with no
    // client counterpart means a stage was renamed on one side only, and
    // the old name will now never appear while still looking supported.
    const orphaned = server.filter((s) => !client.includes(s));
    expect(orphaned).toEqual([]);
  });
});
