import { test, expect } from "@playwright/experimental-ct-react";
import { DriveFilter } from "./DriveFilter";

const drives = [
  { id: "a", started_at: "2026-09-22T09:00:00.000Z" },
  { id: "b", started_at: "2026-08-20T09:00:00.000Z" },
];

test("changes the list without a network call, and meets the tap floor", async ({
  mount,
  page,
}) => {
  let calls = 0;
  await page.route("**/api/**", (r) => {
    calls += 1;
    return r.fulfill({ json: {} });
  });
  await page.setViewportSize({ width: 390, height: 800 });
  const seen: string[] = [];
  const c = await mount(
    <div data-skin="instrument">
      <DriveFilter drives={drives} onChange={(k) => seen.push(k)} />
    </div>,
  );
  const controls = c.getByRole("button");
  const n = await controls.count();
  for (let i = 0; i < n; i++) {
    const b = await controls.nth(i).boundingBox();
    expect(b!.height, "a filter control under the tap floor").toBeGreaterThanOrEqual(44);
  }
  await c.getByRole("button", { name: /7 days/i }).click();
  expect(seen.at(-1)).toBe("week");
  expect(calls, "the filter must not touch the network").toBe(0);
  expect(await c.locator(".rounded-full").count()).toBe(0);
  await expect(c).not.toContainText("\u2192");
});

/**
 * The honesty control's own tap floor, pending state and failure line.
 *
 * The test above never passes `onLoadOlder`, so its 44px loop cannot see
 * this control at all: it only renders when a window reaches back past
 * the oldest drive loaded. Its dates are relative, not the fixed ones
 * above, so the window it needs stays open as the calendar moves.
 */
test("the load-older control meets the tap floor, and says when it is working or broken", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const recent = [
    { id: "a", started_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  ];
  let taps = 0;
  const c = await mount(
    <div data-skin="instrument">
      <DriveFilter
        drives={recent}
        onChange={() => {}}
        onLoadOlder={() => {
          taps += 1;
        }}
      />
    </div>,
  );
  // A 92 day window over a drive from two days ago reaches back past
  // everything loaded, which is what makes the control appear.
  await c.getByRole("button", { name: /92 days/i }).click();
  const older = c.getByRole("button", { name: /Load more/i });
  const box = await older.boundingBox();
  expect(box!.height, "the load-older control is under the tap floor").toBeGreaterThanOrEqual(44);
  await older.click();
  expect(taps).toBe(1);
  expect(await c.locator(".rounded-full").count()).toBe(0);
});

test("the load-older control refuses a second tap while it is working", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const recent = [
    { id: "a", started_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  ];
  let taps = 0;
  const c = await mount(
    <div data-skin="instrument">
      <DriveFilter
        drives={recent}
        onChange={() => {}}
        onLoadOlder={() => {
          taps += 1;
        }}
        loadingOlder
        olderError="Could not load older drives. Tap to try again."
      />
    </div>,
  );
  await c.getByRole("button", { name: /92 days/i }).click();
  const working = c.getByRole("button", { name: /Loading older drives/i });
  await expect(working).toBeDisabled();
  const box = await working.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await expect(c.getByRole("status")).toContainText("Could not load older drives");
  expect(taps, "a tap got through while a load was already in flight").toBe(0);
});
