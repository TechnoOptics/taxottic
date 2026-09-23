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
