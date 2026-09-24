/**
 * What the driver actually receives.
 *
 * unconfirmed-drives.test.ts proves the reminder OBJECT caps its list.
 * This proves the template renders the capped list rather than the full
 * one, which is a separate fact: the object carried both fields, and a
 * template reading the wrong one would pass every test over there while
 * mailing sixty rows after a reinstall.
 *
 * It also pins the two things this email must never say: a dollar
 * figure for a deduction the driver has not confirmed, and a subject
 * claiming a three-week-old drive just finished.
 */

import { describe, expect, it } from "vitest";
import { buildReminders, type PendingDrive } from "@/lib/mileage/unconfirmed-drives";
import { renderDrivesAwaitingEmail } from "./drives-awaiting";

const NOW = Date.parse("2026-08-24T18:00:00Z");
const DAY = 86_400_000;

function drive(over: Partial<PendingDrive> = {}): PendingDrive {
  return {
    tripId: "t1",
    driverUserId: "abel",
    driverName: "Abel Ark",
    driverEmail: "abel@example.com",
    startedAt: new Date(NOW - 3 * DAY).toISOString(),
    endedAt: new Date(NOW - 3 * DAY + 20 * 60_000).toISOString(),
    distanceMiles: 2,
    startPlace: null,
    endPlace: null,
    lastRemindedAt: null,
    ...over,
  };
}

function render(drives: PendingDrive[]) {
  const reminder = buildReminders(drives, NOW)[0];
  return {
    reminder,
    ...renderDrivesAwaitingEmail({
      reminder,
      classifyUrl: "https://taxottic.com/mileage/classify",
    }),
  };
}

const rowCount = (html: string) =>
  (html.match(/<td style="padding:9px 12px/g) ?? []).length / 3;

describe("a 45-day sweep does not empty itself into the inbox", () => {
  it("renders the capped list, not every pending drive", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      drive({
        tripId: `t${i}`,
        startedAt: new Date(NOW - (i + 2) * DAY).toISOString(),
        endedAt: new Date(NOW - (i + 2) * DAY + 20 * 60_000).toISOString(),
      }),
    );
    const { html, text, reminder } = render(many);
    expect(reminder.drives).toHaveLength(30);
    expect(rowCount(html)).toBe(12);
    expect(html).toContain("18 more drives are waiting");
    expect(text).toContain("and 18 more drives");
    // The count and mileage still describe all 30, so the shorter list
    // is not the email understating the backlog.
    expect(html).toContain("30 drives are");
    expect(html).toContain("60 miles in total");
  });

  it("says nothing about extra drives when everything fits", () => {
    const { html, text } = render([drive({ tripId: "a" }), drive({ tripId: "b" })]);
    expect(rowCount(html)).toBe(2);
    expect(html).not.toContain("more drives are waiting");
    expect(text).not.toContain("and 0 more");
  });
});

describe("the email never states a number the driver has not agreed to", () => {
  it("quotes no dollar figure anywhere", () => {
    // The deduction depends on the answer being asked for. Quoting one
    // would be quoting a number the driver never confirmed, which is the
    // failure PR #616 and #617 were both about.
    const { html, text, subject } = render([drive({ distanceMiles: 41.6 })]);
    for (const s of [html, text, subject]) {
      expect(s).not.toMatch(/\$\s*\d/);
      expect(s.toLowerCase()).not.toContain("deduction of");
    }
  });

  it("does not claim a three-week-old drive just finished", () => {
    const { subject } = render([
      drive({
        startedAt: new Date(NOW - 21 * DAY).toISOString(),
        endedAt: new Date(NOW - 21 * DAY + 20 * 60_000).toISOString(),
      }),
    ]);
    expect(subject).not.toContain("just finished");
    expect(subject).toContain("21 days");
  });

  it("leads with the decision when the drive really did just finish", () => {
    const { subject } = render([
      drive({
        startedAt: new Date(NOW - 2 * 3_600_000).toISOString(),
        endedAt: new Date(NOW - 90 * 60_000).toISOString(),
      }),
    ]);
    expect(subject).toBe(
      "1 drive just finished and needs a business or personal call",
    );
  });
});
