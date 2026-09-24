import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * WHAT THIS FILE CAN AND CANNOT SEE.
 *
 * It reads source text for over-long double-quoted STRING LITERALS. That
 * catches a long `title=` or `description=` prop and a long constant. It
 * cannot see JSX text at all, which is most of the copy on this screen:
 * a 249 character paragraph rendered at the bottom of /mileage on every
 * visit with this guard green, and a 188 character one inside the team
 * note. The guard that sees those is
 * components/mileage/MilesFirstDrive.ct.spec.tsx, which mounts the whole
 * screen at 390px and measures rendered innerText per leaf block. The
 * two are complementary and neither replaces the other.
 */
const FILES = [
  "app/mileage/page.tsx",
  "components/mileage/TeamTrackingHealth.tsx",
  "components/mileage/TripList.tsx",
  // The copy-bearing components this branch added.
  "components/mileage/DriveLog.tsx",
  "components/mileage/TeamLog.tsx",
  "components/mileage/DriveFilter.tsx",
  "components/mileage/MilesHead.tsx",
  "components/mileage/TeamViewNote.tsx",
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

/**
 * COMMENTS ARE NOT COPY. These files quote the owner's own words back at
 * the reader ("messy and not user friendly") to say why a control looks
 * the way it does, and a register rule aimed at what a driver READS must
 * not forbid that. So both assertions run over the code with comments
 * removed.
 */
function copyOf(file: string): string {
  const src = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
  // Guard the extractor: a stripper that ate the file would make every
  // assertion below pass against nothing.
  expect(src.trim().length, `${file} stripped to nothing`).toBeGreaterThan(200);
  return src;
}

describe("Miles says the thing and stops", () => {
  for (const f of FILES) {
    it(`${f} has no string over 170 characters`, () => {
      const long = [...copyOf(f).matchAll(LONG_STRING)].map((m) => m[1]);
      expect(long, `${long.length} string(s) over 170 characters`).toEqual([]);
    });

    it(`${f} keeps the retired register out`, () => {
      expect(copyOf(f)).not.toMatch(
        /\b(calm(er|ly)?|gentle|gently|quietly|friendly|scary)\b/i,
      );
    });
  }
});
