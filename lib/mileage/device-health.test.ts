import { describe, it, expect } from "vitest";
import {
  evaluateDriveTrackingHealth,
  describeDriveHealth,
  SILENT_AFTER_MS,
  PARKED_AFTER_MS,
} from "./device-health";

const NOW = 1_800_000_000_000;
const h = (n: number) => n * 3_600_000;

describe("evaluateDriveTrackingHealth", () => {
  it("healthy: recent upload and recent movement", () => {
    const r = evaluateDriveTrackingHealth({
      nowMs: NOW,
      lastUploadMs: NOW - h(0.2),
      lastMovementMs: NOW - h(1),
      trackingEnabled: true,
    });
    expect(r.status).toBe("healthy");
  });

  it("silent: tracking on, no upload past the floor (Grace's iPhone)", () => {
    const r = evaluateDriveTrackingHealth({
      nowMs: NOW,
      lastUploadMs: NOW - SILENT_AFTER_MS - h(1),
      lastMovementMs: NOW - h(50),
      trackingEnabled: true,
    });
    expect(r.status).toBe("silent");
    expect(r.ageMs).toBeGreaterThan(SILENT_AFTER_MS);
  });

  it("parked: uploading fine but no movement past the floor (Abel's Fold)", () => {
    const r = evaluateDriveTrackingHealth({
      nowMs: NOW,
      lastUploadMs: NOW - h(0.1), // uploading right now
      lastMovementMs: NOW - PARKED_AFTER_MS - h(2),
      trackingEnabled: true,
    });
    expect(r.status).toBe("parked");
    expect(r.ageMs).toBeGreaterThan(PARKED_AFTER_MS);
  });

  it("silent takes precedence over parked (no uploads = can't see movement)", () => {
    const r = evaluateDriveTrackingHealth({
      nowMs: NOW,
      lastUploadMs: NOW - SILENT_AFTER_MS - h(10),
      lastMovementMs: NOW - PARKED_AFTER_MS - h(10),
      trackingEnabled: true,
    });
    expect(r.status).toBe("silent");
  });

  it("off: toggle disabled is never an alarm, even with no data", () => {
    const r = evaluateDriveTrackingHealth({
      nowMs: NOW,
      lastUploadMs: NOW - h(100),
      lastMovementMs: null,
      trackingEnabled: false,
    });
    expect(r.status).toBe("off");
  });

  it("never: tracking intended but nothing ever uploaded", () => {
    const r = evaluateDriveTrackingHealth({
      nowMs: NOW,
      lastUploadMs: null,
      lastMovementMs: null,
      trackingEnabled: true,
    });
    expect(r.status).toBe("never");
  });

  it("unknown toggle (old build, no heartbeat) is still watched if uploading", () => {
    const r = evaluateDriveTrackingHealth({
      nowMs: NOW,
      lastUploadMs: NOW - SILENT_AFTER_MS - h(1),
      lastMovementMs: NOW - h(4),
      trackingEnabled: null,
    });
    expect(r.status).toBe("silent");
  });

  it("weekend of no driving does NOT trip parked (generous 48h floor)", () => {
    const r = evaluateDriveTrackingHealth({
      nowMs: NOW,
      lastUploadMs: NOW - h(0.1),
      lastMovementMs: NOW - h(30), // 30h since a drive, still fine
      trackingEnabled: true,
    });
    expect(r.status).toBe("healthy");
  });

  it("uploading but NEVER moved falls back to upload age for stillness", () => {
    const r = evaluateDriveTrackingHealth({
      nowMs: NOW,
      lastUploadMs: NOW - h(0.1),
      lastMovementMs: null,
      trackingEnabled: true,
    });
    // No movement ever, but only 0.1h of uploads -> not yet parked.
    expect(r.status).toBe("healthy");
  });
});

describe("describeDriveHealth", () => {
  it("labels hours under 2 days and days beyond", () => {
    expect(describeDriveHealth({ status: "silent", ageMs: h(5) })).toBe("Silent 5h");
    expect(describeDriveHealth({ status: "parked", ageMs: h(72) })).toBe("Parked 3d");
    expect(describeDriveHealth({ status: "healthy", ageMs: null })).toBe("Tracking");
    expect(describeDriveHealth({ status: "off", ageMs: null })).toBe("Tracking off");
  });
});
