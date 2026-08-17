import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE INVARIANT: web_build and server_build come from OPPOSITE sides.
 *
 * Together they answer "what fraction of devices are on the current
 * bundle" from a query. web_build is what the DEVICE reports it is
 * executing; server_build is what the API stamps as deployed. Equal means
 * current, different means behind.
 *
 * The failure this guards is not a crash. It is the comparison quietly
 * becoming a tautology. Two edits do it:
 *
 *   1. server_build read off the request body, e.g. str("serverBuild").
 *      Then a phone on a bundle from last week sends nothing, the column
 *      is NULL, and the stalest devices in the fleet drop out of the
 *      denominator instead of dominating it. The diagnostic would inherit
 *      the exact failure it was built to detect.
 *
 *   2. web_build also stamped from WEB_BUILD_ID. Then every row compares
 *      equal, rollout reads 100% forever, and the next fix that never
 *      reached a device looks like a fix that did. That reading error is
 *      how a six week bug survived here once already.
 *
 * Neither shows up as a test failure, a log line, or a NULL that looks
 * wrong. Both look perfectly healthy. So they are pinned at the call site.
 *
 * Comments are stripped before every assertion. This repo has twice
 * shipped a guard that matched a doc COMMENT while the code did something
 * else, and the route under test is heavily commented, including comments
 * that name both fields and quote the very expression being searched for.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const ROUTE = join(REPO_ROOT, "app", "api", "mileage", "heartbeat", "route.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Source of the `const payload = { ... }` literal, comments removed. */
function payloadBody(): string {
  const src = stripComments(readFileSync(ROUTE, "utf8"));
  const start = src.indexOf("const payload = {");
  if (start === -1) throw new Error("heartbeat payload not found, test is stale");
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("heartbeat payload literal is unbalanced, test is stale");
}

/**
 * The value expression assigned to one top-level key of the payload,
 * read to the next comma at depth zero so a nested call or object is
 * returned whole rather than truncated at its first comma.
 */
function payloadValue(key: string): string {
  const body = payloadBody();
  const at = body.search(new RegExp(`(^|,)\\s*${key}\\s*:`, "m"));
  if (at === -1) throw new Error(`payload key ${key} not found, test is stale`);
  const from = body.indexOf(":", at) + 1;
  let depth = 0;
  for (let i = from; i < body.length; i++) {
    const c = body[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) return body.slice(from, i).trim();
  }
  return body.slice(from).trim();
}

const RAW = readFileSync(ROUTE, "utf8");
const CODE = stripComments(RAW);

describe("rollout state is readable from a heartbeat row", () => {
  it("finds the payload keys it is meant to check", () => {
    // Guards the guard. If the payload literal or the parser drifted,
    // every assertion below would throw or pass vacuously.
    expect(payloadBody().length).toBeGreaterThan(500);
    expect(payloadValue("web_build").length).toBeGreaterThan(0);
    expect(payloadValue("server_build").length).toBeGreaterThan(0);
  });

  it("stamps server_build from the server's own build constant", () => {
    // Not str("serverBuild"), not body.anything. The reference value must
    // not have to survive the trip that is being measured.
    expect(payloadValue("server_build")).toBe("WEB_BUILD_ID");
    expect(CODE).toMatch(
      /import\s*\{[^}]*\bWEB_BUILD_ID\b[^}]*\}\s*from\s*"@\/lib\/build-id"/,
    );
  });

  it("keeps web_build read from the device, not stamped alongside it", () => {
    // The load-bearing clause. Both fields from one side makes the
    // comparison a tautology that reads as a healthy fleet.
    const webBuild = payloadValue("web_build");
    expect(webBuild).toContain('str("webBuild"');
    expect(webBuild).not.toContain("WEB_BUILD_ID");
  });

  it("writes both fields to both tables from the one payload object", () => {
    // mileage_device_status is upserted FIRST and returns 500 on error, so
    // a column on only one table takes the heartbeat off the air for every
    // device. The single shared payload is what makes that impossible; a
    // future edit that builds a second, status-only object would not be
    // caught by lib/db/schema-contract.test.ts.
    expect(CODE).toMatch(
      /\.from\("mileage_device_status"\)\s*\.upsert\(payload,/,
    );
    expect(CODE).toMatch(
      /\.from\("mileage_device_heartbeats"\)\s*\.insert\(payload\)/,
    );
  });
});
