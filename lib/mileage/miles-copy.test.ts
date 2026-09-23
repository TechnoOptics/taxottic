import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const FILES = [
  "app/mileage/page.tsx",
  "components/mileage/TeamTrackingHealth.tsx",
  "components/mileage/TripList.tsx",
];

/**
 * The brief's regex was `/"([^"\\]{171,})"/g` run against the raw file.
 * On these three files that matches dozens of spans that are not
 * strings at all: a JS/TS double-quoted string literal can never
 * contain a raw newline, so any run of "([^"\\]{171,})" that crosses a
 * line break is regex punctuation pairing two UNRELATED quotes (e.g. a
 * className's closing quote and the next unrelated string's opening
 * quote) across everything in between - code, JSX, prose comments. On
 * this branch, post tasks 5/5A/6, that produced 44 / 6 / 26 "matches"
 * per file instead of the four real strings the brief describes.
 *
 * Two narrow fixes keep the brief's threshold and file list intact
 * while making the match set correspond to actual string literals:
 *   - exclude \n from the character class, since a real string literal
 *     cannot contain one (this alone drops the count to 1 / 0 / 1);
 *   - exclude `className="..."` specifically, because a class list is
 *     not text rendered on screen and the 170-char rule in the task
 *     brief is scoped to "any string RENDERED on this screen".
 * Verified against this branch: with both fixes the only remaining
 * match is the MobileOnly description in page.tsx (173 chars).
 */
const LONG_STRING = /(?<!className=)"([^"\\\n]{171,})"/g;

describe("Miles says the thing and stops", () => {
  for (const f of FILES) {
    it(`${f} has no string over 170 characters`, () => {
      const src = readFileSync(f, "utf8");
      const long = [...src.matchAll(LONG_STRING)].map((m) => m[1]);
      expect(long, `${long.length} string(s) over 170 characters`).toEqual([]);
    });

    it(`${f} keeps the retired register out`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/\b(calm(er|ly)?|gentle|gently|quietly|friendly|scary)\b/i);
    });
  }
});
