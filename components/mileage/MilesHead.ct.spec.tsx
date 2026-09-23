import { test, expect } from "@playwright/experimental-ct-react";
import { MilesHead } from "./MilesHead";
import { DriverPicker } from "./DriverPicker";
import { TeamTrackingHealth } from "./TeamTrackingHealth";
import { TrackingHealthBanner } from "./TrackingHealthBanner";

/**
 * What stands between opening Miles and reading a drive.
 *
 * The head was a breadcrumb, a two-line title, a company line, a tracking
 * alert, a driver selector, a Team view row, a "3 drives need a quick
 * call" card and eight pills in five treatments, every one of them 32px
 * tall, measured at 390px. The owner's words were "messy and not user
 * friendly". These tests hold what replaced it: who you are reading, what
 * it comes to, and a count of what waits.
 */

test("one identity line, a total, and nothing else above the drives", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const c = await mount(
    <div data-skin="instrument">
      <MilesHead
        who="Your drives"
        miles={312}
        deductionCents={21800}
        driveCount={14}
        awaiting={3}
      />
    </div>,
  );
  await expect(c).toContainText("Your drives");
  await expect(c).toContainText("3 waiting");
  // The card and the orange pill are gone: the row carries the choice.
  await expect(c).not.toContainText("need a quick call");
  expect(await c.locator(".rounded-full").count()).toBe(0);
  await expect(c).not.toContainText("→");
  const texts = await c.locator("*").allInnerTexts();
  for (const t of texts) {
    expect(t.length, `a string over 170 characters: ${t.slice(0, 60)}`).toBeLessThanOrEqual(170);
  }
});

test("the total is in the data face and names what it counts", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const c = await mount(
    <div data-skin="instrument">
      <MilesHead
        who="Your drives"
        miles={312}
        deductionCents={21800}
        driveCount={14}
        awaiting={0}
      />
    </div>,
  );
  await expect(c).toContainText("312 mi");
  await expect(c).toContainText("$218.00");
  await expect(c).toContainText("14 drives");
  // Figures are set in the data face, which is the whole reason a column
  // of them can be scanned (globals.css, .figure).
  expect(await c.locator(".figure").count()).toBeGreaterThan(0);
  // Nothing waits, so nothing is said about waiting. The row asks.
  await expect(c).not.toContainText("waiting");
});

test("the waiting count is a link to the first drive that wants one", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const c = await mount(
    <div data-skin="instrument">
      <MilesHead
        who="Your drives"
        miles={0}
        deductionCents={0}
        driveCount={3}
        awaiting={1}
        waitingHref="#first-unclassified"
      />
    </div>,
  );
  const link = c.getByRole("link", { name: /waiting/ });
  await expect(link).toHaveAttribute("href", "#first-unclassified");
  await expect(link).toContainText("1 waiting");
});

test("a caller that promises no anchor gets the deck, not a dead tap", async ({
  mount,
  page,
}) => {
  // The count is taken across every company and every date; the anchor
  // exists only among the rows a caller rendered. A caller that says
  // nothing about what it rendered must not be given the anchor, because
  // an anchor that is not in the document is a tap that does nothing.
  await page.setViewportSize({ width: 390, height: 800 });
  const c = await mount(
    <div data-skin="instrument">
      <MilesHead
        who="All drivers"
        miles={0}
        deductionCents={0}
        driveCount={0}
        awaiting={4}
      />
    </div>,
  );
  await expect(c.getByRole("link", { name: /waiting/ })).toHaveAttribute(
    "href",
    "/mileage/classify",
  );
});

test("every control the thumb reaches is at least 44px", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const c = await mount(
    <div data-skin="instrument">
      <MilesHead
        who="Grace Hopper"
        miles={312}
        deductionCents={21800}
        driveCount={14}
        awaiting={3}
        where="Techno Optics LLC"
        switcher={
          <DriverPicker
            selfUserId="u-self"
            drivers={[
              { userId: "u-self", label: "Abel · you" },
              { userId: "u-2", label: "Grace Hopper · Field" },
            ]}
            current="u-2"
          />
        }
        /* THE REAL NODES, both slots. An earlier version of this test
           mounted the head with no tracking node and a hand-written
           stand-in for none of it, so it measured neither injected slot
           and was green while the real head carried a 39px summary and
           a round 8px dot. A guard that cannot see a whole slot reads as
           coverage; this repo has shipped that mistake three times. */
        tracking={
          <>
            <TeamTrackingHealth
              rows={[
                {
                  userId: "u-2",
                  label: "Grace Hopper · Field",
                  health: { status: "silent", ageMs: 42 * 3_600_000 },
                  cause: "authorization_downgraded",
                  platform: "ios",
                },
              ]}
            />
            <details className="w-full rounded-xl border border-amber-300 bg-amber-50/60">
              <summary className="mono-label flex min-h-11 cursor-pointer select-none list-none items-center gap-2 px-3 text-amber-900">
                Tracking needs attention
              </summary>
              <div className="px-1 pb-1">
                <TrackingHealthBanner
                  reason="Stops are being logged and drives are not."
                  cause="Location is While Using."
                  recoverable={0}
                  recoverAction={async () => {}}
                />
              </div>
            </details>
          </>
        }
      />
    </div>,
  );
  // Every control a thumb can actually reach: the ones inside a closed
  // <details> measure zero and are nobody's tap target until the summary
  // above them is tapped, and that summary is measured here.
  const small = await c.locator("a, button, summary, [role=button]").evaluateAll(
    (els) =>
      els
        .map((el) => ({
          text: (el.textContent ?? "").trim().slice(0, 40),
          h: Math.round(el.getBoundingClientRect().height),
        }))
        .filter((m) => m.h > 0 && m.h < 44),
  );
  expect(small, `controls under 44px: ${JSON.stringify(small)}`).toEqual([]);
  // The head still carries every capability it did: who is being read,
  // the switch to somebody else, and the tracking detail.
  await expect(c).toContainText("Grace Hopper");
  await expect(c).toContainText("Techno Optics LLC");
  await expect(c.getByLabel("View another driver's drives")).toBeVisible();
  await expect(c).toContainText("Tracking needs attention");
  await expect(c).toContainText("Some devices aren't tracking");
  // Including everything the two slots brought with them.
  expect(await c.locator(".rounded-full").count()).toBe(0);
  await expect(c).not.toContainText("\u2192");
});
