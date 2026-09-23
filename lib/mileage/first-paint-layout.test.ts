import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * THE INVARIANT: on the drive log, the head and the map are on screen at
 * first paint on the narrowest phone we ship to, WITH the manager's
 * device alert still present, and the question "business or personal?"
 * is asked once.
 *
 * The drives were loading fine (#622, #623). The layout was hiding them.
 * On a Galaxy Z Fold5 cover screen a manager saw: title, a full-height
 * amber card about a TEAMMATE'S phone, the driver picker, then a grey
 * card of prose that says the same thing every visit. Every control and
 * every drive sat below the fold, which is what "click around hoping the
 * drive shows up" was describing.
 *
 * The first fix kept every word and moved it behind a tap: both cards
 * became a native <details> closed by default. The second collapsed the
 * head itself, which at 390px had put the window filter at 769px and the
 * first drive row at 1405px. These guards hold both shapes. The pixel
 * budgets are proved by the component tests
 * components/mileage/MileageFirstPaint.ct.spec.tsx at 344x882 and
 * components/mileage/MilesFirstDrive.ct.spec.tsx at 390x844.
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
const MILES_HEAD = "components/mileage/MilesHead.tsx";
const TRIP_LIST = "components/mileage/TripList.tsx";
const DRIVE_LOG = "components/mileage/DriveLog.tsx";

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
const milesHead = source(MILES_HEAD);
const list = source(TRIP_LIST);
const log = source(DRIVE_LOG);

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

  it("is the head's tracking marker, on both arms of the page", () => {
    // It used to be a block of its own between the title and the
    // controls, so this used to be an ordering assertion. It is the
    // head's marker now: built once as `trackingMarker` and handed to
    // whichever arm renders the head (MilesHead directly for the team
    // overlay, DriveLog for the single-driver view, because the total
    // under the identity line has to follow the filter). Ordering in the
    // source says nothing about that, so this holds the wiring instead.
    const at = page.indexOf("const trackingMarker =");
    expect(at, "the marker is not built at all").toBeGreaterThan(-1);
    const marker = page.slice(at, page.indexOf("<MilesHead"));
    expect(marker, "the alert is not in the marker").toMatch(
      /<TeamTrackingHealth/,
    );
    for (const el of ["<MilesHead", "<DriveLog"]) {
      const from = page.indexOf(el);
      expect(from, `${el} is not rendered`).toBeGreaterThan(-1);
      expect(
        page.slice(from, page.indexOf("/>", page.indexOf("tracking=", from))),
        `${el} is not given the tracking marker`,
      ).toMatch(/tracking=\{trackingMarker\}/);
    }
  });

  it("is a marker the head shows only when a phone needs attention", () => {
    // A marker on every visit that says nothing is the noise this screen
    // was cut for, and the rule for which phones count lives in
    // TeamTrackingHealth, not in a second copy on the page.
    expect(page).toMatch(/const teamNeedsAttention = [^;]*driversNeedingAttention\(/);
    expect(health).toMatch(/export function driversNeedingAttention/);
  });
});

describe("the classification question is asked once, on the row", () => {
  /**
   * THE DEFECT: /mileage asked the same question three times before the
   * reader reached a drive. An amber "3 drives need a quick call" card,
   * an orange "Needs your call" pill in the control row, and a "Need
   * review" stat below the list, all above a list whose every row
   * already carries a business-or-personal control backed by a server
   * action. The owner's words were "messy and not user friendly".
   *
   * The head states the count and links to the first drive waiting; the
   * row is where the decision is made. These guards are source-level
   * because the regression is the presence of the markup, and the page
   * is an async server component that mounts in no test.
   */
  it("keeps the amber card out of the head", () => {
    expect(page, "the review card is back above the drives").not.toMatch(
      /needs? a quick call/i,
    );
  });

  it("keeps the pill out of the control row", () => {
    expect(page).not.toMatch(/<NeedsDecisionPill/);
    expect(page, "the pill's own words are back").not.toMatch(
      /Needs your call/,
    );
  });

  it("keeps the duplicate stat tiles out", () => {
    // Business miles, the deduction and the waiting count are the head.
    expect(page).not.toMatch(/<Stat\b/);
    expect(page).not.toMatch(/Need review/);
  });

  it("states the count in the head and points it at the row", () => {
    for (const el of ["<MilesHead", "<DriveLog"]) {
      const at = page.indexOf(el);
      expect(at, `${el} is not rendered`).toBeGreaterThan(-1);
      const tag = page.slice(at, page.indexOf("/>", page.indexOf("tracking=", at)));
      expect(tag, `${el} is not given the waiting count`).toMatch(
        /awaiting=\{[^}]*awaitingCount/,
      );
    }
    // The head links where its caller says, and its default is the deck
    // rather than the anchor: the count is taken across every company
    // and every date, and only a caller holding the rows can know the
    // anchor is in the document at all.
    expect(milesHead).toMatch(/href=\{waitingHref\}/);
    expect(milesHead).toMatch(
      /waitingHref = CLASSIFY_DECK|waitingHref = "\/mileage\/classify"/,
    );
    // And the caller that does hold the rows promises the anchor only
    // while every waiting drive is among them.
    expect(log, "the drive log does not decide the destination").toMatch(
      /awaitingShown >= awaiting\s*\?\s*"#first-unclassified"/,
    );
    expect(list, "no row carries the anchor the head links to").toMatch(
      /id=\{anchor \? "first-unclassified" : undefined\}/,
    );
    for (const [src, name] of [
      [list, "the anchored row"],
      [log, "the drive log's count of what is on screen"],
    ] as const) {
      expect(src, `${name} is not chosen by the shared rule`).toMatch(
        /isAwaitingDecision\(/,
      );
    }
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
