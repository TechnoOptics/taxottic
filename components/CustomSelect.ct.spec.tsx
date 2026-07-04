import { test, expect } from "@playwright/experimental-ct-react";
import { CustomSelect } from "./CustomSelect";

// The access-level roles, the real long labels that once overflowed on
// mobile (the Samsung Galaxy Z case in CustomSelect's own comment).
const ROLE_OPTIONS = [
  { value: "owner", label: "Owner, full access to everything" },
  { value: "manager", label: "Manager, manage the team and the books" },
  { value: "member", label: "Member, expenses, mileage & chat only" },
];

// Mirrors how the app styles the access-level field.
const FIELD_CLASS =
  "w-full rounded-xl border border-forest-200 bg-cream px-3 py-2.5 text-sm text-forest-900";

test.describe("CustomSelect", () => {
  test("long label stays inside a narrow field (mobile overflow guard)", async ({
    mount,
  }) => {
    // Inner box is deliberately narrow (the overflow condition); the outer
    // wrapper is wider with the inner boundary drawn, so if the select ever
    // spills past its container again it shows up in the capture.
    const component = await mount(
      <div style={{ width: 420, padding: 20, background: "#ffffff" }}>
        <div
          style={{
            width: 250,
            outline: "1px dashed #b0bcd6",
            background: "#eef1f6",
          }}
        >
          <CustomSelect
            name="access_level"
            className={FIELD_CLASS}
            options={ROLE_OPTIONS}
            defaultValue="manager"
          />
        </div>
      </div>,
    );

    // Sanity: confirm the app's theme stylesheet actually loaded, bg-cream
    // must resolve to a real color, else we'd be screenshotting unstyled
    // markup that catches nothing.
    const bg = await component
      .locator("button")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");

    await expect(component).toHaveScreenshot("custom-select-narrow.png");
  });

  test("open dropdown lists all options", async ({ mount }) => {
    const component = await mount(
      <div style={{ width: 320, padding: 16, background: "#ffffff" }}>
        <CustomSelect
          name="access_level"
          className={FIELD_CLASS}
          options={ROLE_OPTIONS}
          defaultValue="member"
        />
      </div>,
    );
    await component.locator("button").click();
    await expect(component).toHaveScreenshot("custom-select-open.png");
  });
});
