import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * This product is sold to United States businesses and computes United
 * States tax. Every number a user reads must be formatted the American
 * way, and the failure mode is silent: a date renders 10/08/2026 instead
 * of 08/10/2026 and nobody notices until someone files against the wrong
 * month.
 *
 * `toLocaleDateString()` with no locale uses whatever the RUNTIME has.
 * That is the server's locale during SSR and the handset's locale in the
 * WebView, so the same screen can render American on one device and
 * European on another, and neither is a setting anyone chose. 112 such
 * calls existed across 38 files.
 *
 * Pinning "en-US" is safe for numbers as well as dates: it gives comma
 * thousands separators and a period decimal, which is what every dollar
 * figure in this app already assumes.
 *
 * Miles, not kilometres: distance is stored in miles throughout
 * (METERS_PER_MILE in lib/mileage/segmentation.ts) because the IRS
 * mileage deduction is denominated per mile. A metric unit reaching a
 * user-facing string would be a correctness bug, not a preference.
 */

const SEARCH_DIRS = ["app", "components", "lib"];
const SOURCE_EXT = [".ts", ".tsx"];

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
    else if (SOURCE_EXT.some((x) => e.endsWith(x)) && !e.includes(".test."))
      out.push(full);
  }
  return out;
}

const FILES = SEARCH_DIRS.flatMap((d) => sourceFiles(d));

describe("United States formatting", () => {
  it("finds the sources at all", () => {
    // Guards the guard: an empty file list would make every assertion
    // below vacuously pass, a failure mode this repo has shipped before.
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("never formats a date or number without pinning the locale", () => {
    const bare: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        if (
          /\.toLocaleDateString\(\s*\)/.test(line) ||
          /\.toLocaleTimeString\(\s*\)/.test(line) ||
          /\.toLocaleString\(\s*\)/.test(line)
        ) {
          bare.push(`${f}:${i + 1}`);
        }
      });
    }
    expect(
      bare,
      'These format with the RUNTIME locale, so the same screen renders ' +
        'differently on a phone set to en-GB. Pass "en-US" explicitly.',
    ).toEqual([]);
  });

  it("uses only en-US when a locale is given", () => {
    const foreign: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(
        /toLocale(?:Date|Time)?String\(\s*["']([a-zA-Z-]+)["']|Intl\.[A-Za-z]+Format\(\s*["']([a-zA-Z-]+)["']/g,
      )) {
        const loc = m[1] ?? m[2];
        if (loc && loc !== "en-US") foreign.push(`${f}: ${loc}`);
      }
    }
    expect(foreign).toEqual([]);
  });

  it("uses only USD for currency", () => {
    const foreign: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/currency:\s*["']([A-Z]{3})["']/g)) {
        if (m[1] !== "USD") foreign.push(`${f}: ${m[1]}`);
      }
    }
    expect(foreign).toEqual([]);
  });

  it("keeps metric units out of user-facing copy", () => {
    // Deliberately scoped to JSX text and string literals rather than
    // the whole file: the mileage engine legitimately works in metres
    // internally (haversine returns metres) and converts at the edge.
    const metric: string[] = [];
    for (const f of FILES) {
      if (!f.endsWith(".tsx")) continue;
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        if (/>[^<]*\b(kilometers?|kilometres?|Celsius)\b/i.test(line)) {
          metric.push(`${f}:${i + 1}`);
        }
      });
    }
    expect(
      metric,
      "IRS mileage is denominated per MILE. A metric unit on screen is a " +
        "correctness bug, not a preference.",
    ).toEqual([]);
  });
});
