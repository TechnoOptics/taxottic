import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * THE INVARIANT: when a driver's own mileage_device_status row already
 * says why the phone is not tracking, both people who can act on it are
 * told that cause, with the Settings path, instead of a guess.
 *
 * The defect these guards hold shut. Driver c6218e2c's row read
 * location_authorization = 'whenInUse' and self_check =
 * 'denied=geofence_armed,location_always' for nine days while the
 * manager's alert said "Silent 42h" plus prose that "usually" it is
 * While Using, and the driver's own page said nothing at all. The pure
 * evaluator (device-cause.ts) has its own tests; these check that the
 * page and the two components actually FEED it and RENDER it, because
 * this repo's default failure is a correct module with no caller.
 *
 * Source-level on purpose: server components do not mount under vitest.
 * Comments are stripped before every assertion, including trailing `//`
 * comments, because these files name the fields in prose.
 */

const PAGE = "app/mileage/page.tsx";
const LOADER = "lib/mileage/team-health.ts";
const TEAM_HEALTH = "components/mileage/TeamTrackingHealth.tsx";
const BANNER = "components/mileage/TrackingHealthBanner.tsx";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "");
}

function source(path: string): string {
  if (!existsSync(path)) return "";
  return stripComments(readFileSync(path, "utf8")).replace(/\s+/g, " ");
}

const page = source(PAGE);
const loader = source(LOADER);
const team = source(TEAM_HEALTH);
const banner = source(BANNER);

/** The columns the cause is derived from. All pre-existing on the row. */
const CAUSE_COLUMNS = [
  "platform",
  "location_authorization",
  "background_refresh",
  "low_power_mode",
  "battery_optimized",
  "tracking_enabled",
];

describe("the team loader derives a cause from the status row", () => {
  it("selects every column the cause reads", () => {
    const sel = loader.match(
      /from\("mileage_device_status"\)\s*\.select\("([^"]*)"\)/,
    );
    expect(sel, "no select on mileage_device_status").not.toBeNull();
    for (const col of CAUSE_COLUMNS) {
      expect(sel![1], `select is missing ${col}`).toContain(col);
    }
  });

  it("calls the pure evaluator and puts its verdict on the per-driver row", () => {
    expect(loader).toMatch(/evaluateDeviceCause\s*\(/);
    expect(loader).toMatch(/cause:\s*/);
    expect(loader).toMatch(/platform:\s*/);
  });
});

describe("the manager's alert names the cause per driver", () => {
  it("renders the cause text on the row", () => {
    expect(team).toMatch(/describeDeviceCause\s*\(/);
    expect(team).toMatch(/"manager"/);
  });

  it("keeps the generic Silent sentence only as the fallback for a driver with no known cause", () => {
    const at = team.indexOf("Silent means the phone stopped uploading");
    expect(at, "the Silent sentence is gone").toBeGreaterThan(-1);
    // The condition that guards the sentence sits just before it.
    const guard = team.slice(Math.max(0, at - 200), at);
    expect(guard).toMatch(/cause\s*==\s*null|!\s*r\.cause|cause\s*===\s*null/);
  });

  it("keeps the cause inside the details, not on the collapsed summary", () => {
    // Measured in MileageFirstPaint.ct.spec.tsx at 344px: the summary
    // has no room for a cause without wrapping the headline.
    const sumStart = team.indexOf("<summary");
    const sumEnd = team.indexOf("</summary>");
    const summary = team.slice(sumStart, sumEnd);
    expect(summary).not.toMatch(/describeDeviceCause|\.cause/);
  });
});

describe("the driver's own page tells them their own cause", () => {
  it("reads the viewer's own status row, self view only", () => {
    const sel = page.match(
      /from\("mileage_device_status"\)\s*\.select\("([^"]*)"\)/,
    );
    expect(sel, "the page never reads mileage_device_status").not.toBeNull();
    for (const col of CAUSE_COLUMNS) {
      expect(sel![1], `select is missing ${col}`).toContain(col);
    }
    // Same gate as the other self diagnostics: never for a teammate. The
    // gate must be THIS read's own condition; a window of nearby source
    // also contains the tracking-health read's gate and reads as
    // coverage when this one is dropped (mutation-tested).
    expect(page).toMatch(
      /wantsSelfDiagnostics \? admin \.from\("mileage_device_status"\)/,
    );
  });

  it("derives the cause with the same pure evaluator, never a second one", () => {
    expect(page).toMatch(/evaluateDeviceCause\s*\(/);
  });

  it("hands the cause to the banner, and shows the banner for it", () => {
    const at = page.indexOf("<TrackingHealthBanner");
    expect(at).toBeGreaterThan(-1);
    const tag = page.slice(at, page.indexOf("/>", at));
    expect(tag).toMatch(/cause=\{/);
    // The render condition must admit a cause with no "degraded" verdict:
    // Grace had zero uploads, so the teleport detector said "idle".
    const cond = page.slice(Math.max(0, at - 300), at);
    expect(cond).toMatch(/selfCause|Cause\b/);
  });

  it("a driver who turned tracking off is not alarmed about their own choice", () => {
    expect(page).toMatch(/tracking_enabled\s*!==\s*false|trackingEnabled\s*!==\s*false/);
  });
});

describe("the driver's banner renders the cause", () => {
  it("accepts and renders a cause line", () => {
    expect(banner).toMatch(/cause\??:\s*/);
    expect(banner).toMatch(/\{cause/);
  });

  it("keeps every existing sentence", () => {
    expect(banner).toContain("Your drives aren&rsquo;t being recorded");
    expect(banner).toContain("Open location settings");
    expect(banner).toContain("Run the reliability check");
  });
});
