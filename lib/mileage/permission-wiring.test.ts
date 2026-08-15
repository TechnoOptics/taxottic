import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every permission we can request must actually be requested somewhere.
 *
 * THE BUG THIS CATCHES, found on a real device 2026-08-15.
 *
 * The car-Bluetooth wake trigger was fully built and completely dead:
 *
 *   TaxotticCarSignalsPlugin.requestBluetoothPermission   existed
 *   requestCarBluetoothPermission() in car-signals.ts      existed
 *   anything calling it                                    DID NOT
 *
 * So BLUETOOTH_CONNECT sat at granted=false on a driver's phone with no
 * USER_SET flag: not declined, never offered. Without it the receiver
 * cannot read a connecting device's Bluetooth class, so every car
 * connect was discarded before the vehicle test ran, and vehicleConnects
 * could never leave zero. That driver had SIX correctly classified cars
 * paired. Not one had ever woken the tracker.
 *
 * A dead permission helper is invisible in every other way. It compiles,
 * it type-checks, it is exported, and the feature it gates simply never
 * happens. The only detectable symptom is a permission that is neither
 * granted nor denied, which nobody thinks to look at.
 *
 * Hence a static check: an exported request* helper with no caller
 * outside its own module is a feature nobody can ever turn on.
 */

const SEARCH_DIRS = ["app", "components", "lib"];
const MODULES = ["lib/mileage/car-signals.ts", "lib/mileage/device-status.ts"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(e) && !e.includes(".test.")) out.push(full);
  }
  return out;
}

const FILES = SEARCH_DIRS.flatMap((d) => sourceFiles(d));

/** Exported `request…` helpers, which are always permission prompts here. */
function exportedRequesters(modulePath: string): string[] {
  const src = readFileSync(modulePath, "utf8");
  return [
    ...src.matchAll(/export\s+(?:async\s+)?function\s+(request[A-Z]\w*)/g),
  ].map((m) => m[1]);
}

describe("no permission prompt is left unwired", () => {
  it("finds the modules and their request helpers", () => {
    // Guards the guard: a moved file would make this vacuous, and
    // vacuous is precisely how the original bug survived.
    const all = MODULES.flatMap(exportedRequesters);
    expect(all.length).toBeGreaterThan(2);
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("every exported request* helper has a caller outside its module", () => {
    const orphans: string[] = [];

    for (const modulePath of MODULES) {
      for (const fn of exportedRequesters(modulePath)) {
        const called = FILES.some((f) => {
          if (f === modulePath || f.endsWith(modulePath)) return false;
          const src = readFileSync(f, "utf8");
          // A bare import is not a call. Require the invocation.
          return new RegExp(`\\b${fn}\\s*\\(`).test(src);
        });
        if (!called) orphans.push(`${fn} (${modulePath})`);
      }
    }

    expect(
      orphans,
      "These permission helpers are exported and never called, so the " +
        "permission is never requested and the feature behind it can " +
        "never switch on. The symptom on device is a permission that is " +
        "neither granted nor denied, which is what hid the car-Bluetooth " +
        "wake trigger while six paired cars failed to start tracking.",
    ).toEqual([]);
  });

  it("the car Bluetooth prompt specifically is reachable from setup", () => {
    // Named explicitly because this is the one that was dead, and
    // because the setup page is the only surface a driver can reach it
    // from. A generic check would pass if it were called from somewhere
    // unreachable.
    const setup = readFileSync("app/mileage/setup/page.tsx", "utf8");
    expect(setup).toMatch(/requestCarBluetoothPermission\s*\(/);
  });
});
