import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * THE INVARIANT: on the drive log, the driver's own controls (the
 * "Needs your call" pill, the range pills) and the map are on screen at
 * first paint on the narrowest phone we ship to, WITH the manager's
 * device alert still present.
 *
 * The drives were loading fine (#622, #623). The layout was hiding them.
 * On a Galaxy Z Fold5 cover screen a manager saw: title, a full-height
 * amber card about a TEAMMATE'S phone, the driver picker, then a grey
 * card of prose that says the same thing every visit. Every control and
 * every drive sat below the fold, which is what "click around hoping the
 * drive shows up" was describing.
 *
 * The fix keeps every word and moves it behind a tap: both cards become
 * a native <details> that is closed by default. These guards hold that
 * shape. The pixel budget itself is proved by the component test
 * components/mileage/MileageFirstPaint.ct.spec.tsx at 344x882.
 *
 * Source-level on purpose. Server components do not mount under vitest,
 * and this repo's default failure is a correct module with the wrong
 * caller, so the page is checked at the call site too. Comments are
 * stripped before every assertion, including trailing `//` comments,
 * because the files under test name these elements in prose.
 */

const PAGE = "app/mileage/page.tsx";
const TEAM_HEALTH = "components/mileage/TeamTrackingHealth.tsx";
const TEAM_NOTE = "components/mileage/TeamViewNote.tsx";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "");
}

/**
 * Missing file reads as empty so the assertion names what is missing
 * instead of the suite erroring out on the read. Whitespace is collapsed
 * so a sentence that Prettier wraps across source lines still matches
 * the sentence a reader sees.
 */
function source(path: string): string {
  if (!existsSync(path)) return "";
  return stripComments(readFileSync(path, "utf8")).replace(/\s+/g, " ");
}

const page = source(PAGE);
const health = source(TEAM_HEALTH);
const note = source(TEAM_NOTE);

/**
 * The <details> element enclosing `needle`: its opening tag (so `open`
 * can be checked) and everything up to its close (so containment can
 * be checked). Null when the needle is not inside one.
 */
function detailsAround(src: string, needle: string) {
  const at = src.indexOf(needle);
  if (at < 0) return null;
  const start = src.lastIndexOf("<details", at);
  const end = src.indexOf("</details>", at);
  if (start < 0 || end < 0) return null;
  return {
    tag: src.slice(start, src.indexOf(">", start) + 1),
    inner: src.slice(start, end),
  };
}

function summaryOf(src: string): string {
  const at = src.indexOf("<summary");
  const end = src.indexOf("</summary>", at);
  return at < 0 || end < 0 ? "" : src.slice(at, end);
}

describe("the manager's device alert is one line until tapped", () => {
  it("keeps its list and prose inside a details element", () => {
    const block = detailsAround(health, "Ask them to open Taxottic");
    expect(block, "the alert body is not inside a <details>").not.toBeNull();
  });

  it("is closed by default, so it costs one line on first paint", () => {
    const block = detailsAround(health, "Ask them to open Taxottic");
    expect(block?.tag ?? "", "the alert renders open").not.toMatch(/\bopen\b/);
  });

  it("puts the headline and the count in the summary, so the strip still reads as an alert", () => {
    const summary = summaryOf(health);
    expect(summary, "no <summary>").not.toBe("");
    expect(summary).toMatch(/Some devices aren&apos;t tracking/);
    expect(summary).toMatch(/attention\.length/);
    expect(summary).toMatch(/rows\.length/);
  });

  it("keeps every sentence of the alert wording, verbatim", () => {
    // The wording was written carefully and the task was to reshape the
    // container, not the copy. The one em dash below is pre-existing in
    // that copy and is quoted as an escape so this file carries none.
    const sentences = [
      "Silent means the phone stopped uploading, usually location permission dropped to “While Using” or the app was force-closed. ",
      "Background refresh off means iOS will not wake Taxottic for any drive. That phone cannot track until it is turned back on in Settings > General > Background App Refresh. ",
      "Parked means the phone is uploading but hasn’t moved in days, it may not be the device that person drives with. ",
      "Ask them to open Taxottic, update if prompted, and confirm location is set to Always.",
    ];
    for (const s of sentences) {
      expect(health, `missing: ${s.slice(0, 40)}`).toContain(s);
    }
    expect(health).toMatch(/describeDriveHealth\s*\(/);
  });

  it("is rendered by the drive log ahead of the controls, not demoted below the map", () => {
    const alert = page.indexOf("<TeamTrackingHealth");
    const pill = page.indexOf("<NeedsDecisionPill");
    const map = page.indexOf("<MileageMap");
    expect(alert, "the alert is not rendered").toBeGreaterThan(-1);
    expect(pill, "the control row is not rendered").toBeGreaterThan(-1);
    expect(alert).toBeLessThan(pill);
    expect(pill).toBeLessThan(map);
  });
});

describe("the team-view note is one line until tapped", () => {
  it("is rendered by the drive log", () => {
    expect(page).toMatch(/<TeamViewNote\b/);
  });

  it("keeps its explanation inside a details element that is closed by default", () => {
    const block = detailsAround(note, "never their personal miles");
    expect(block, "the note's prose is not inside a <details>").not.toBeNull();
    expect(block?.tag ?? "", "the note renders open").not.toMatch(/\bopen\b/);
  });

  it("keeps the link to the manager's own log outside the details, visible without a tap", () => {
    // This link is how a manager whose default view is the whole team
    // gets back to their own drives. Folding it away would turn one tap
    // into two on the very screen this exists to shorten.
    const block = detailsAround(note, "never their personal miles");
    expect(note, "the own-log link is gone").toMatch(/My drive log/);
    expect(block?.inner ?? "").not.toMatch(/My drive log/);
  });

  it("still says what teammates share and what they keep private", () => {
    expect(note).toContain(
      "Teammates show confirmed business drives only, never their personal miles.",
    );
  });
});
