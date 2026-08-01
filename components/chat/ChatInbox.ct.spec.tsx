import { test, expect } from "@playwright/experimental-ct-react";
import { ChatInbox } from "./ChatInbox";
import type { InboxRow } from "@/lib/chat/inbox";

/**
 * Visual guard for the chat inbox at both ends of the range it has to
 * survive: a 344px Galaxy Fold cover screen inside the mobile WebView,
 * and a desktop window.
 *
 * The rows carry long names and long previews on purpose. Truncation,
 * the timestamp column and the unread dot are the three things most
 * likely to push a row wide at 344px.
 */

const ME = "user-me";
const SAM = "user-sam";
const JO = "user-jo";

const MEMBERS = [
  { user_id: ME, role: "manager", full_name: "Riley Owner", email: "riley@example.com" },
  { user_id: SAM, role: "expenser", full_name: "Samantha Delacroix", email: "sam@example.com" },
  { user_id: JO, role: "expenser", full_name: null, email: "jo.baker@example.com" },
];

const ROWS: InboxRow[] = [
  {
    id: "conv-dm-sam",
    kind: "dm",
    title: "Samantha Delacroix",
    preview: "Can you look at the Q3 mileage export before I send it on?",
    lastActivity: "2026-07-31T16:42:00.000Z",
    unread: true,
    otherUserId: SAM,
    memberCount: 2,
  },
  {
    id: "conv-group-payroll",
    kind: "group",
    title: "Payroll and benefits",
    preview: "You: pushed the numbers into the forecast, take a look",
    lastActivity: "2026-07-30T09:05:00.000Z",
    unread: false,
    otherUserId: null,
    memberCount: 3,
  },
  {
    id: "conv-dm-jo",
    kind: "dm",
    title: "jo.baker",
    preview: "Sent a file",
    lastActivity: "2026-07-28T11:20:00.000Z",
    unread: false,
    otherUserId: JO,
    memberCount: 2,
  },
  {
    id: "conv-general",
    kind: "channel",
    title: "General",
    preview: "Nothing posted here yet",
    lastActivity: null,
    unread: false,
    otherUserId: null,
    memberCount: 3,
  },
];

async function noop() {}

function harness() {
  return (
    <div style={{ padding: 12, background: "var(--background)" }}>
      <ChatInbox
        companyId="company-1"
        companyPublicId="co_example123"
        currentUserId={ME}
        rows={ROWS}
        companyMembers={MEMBERS}
        createGroupAction={noop}
        createDmAction={noop}
      />
    </div>
  );
}

// Tailwind breakpoints key off the viewport, not the container, so the
// width has to be set on the page for `sm:` and friends to behave the
// way they will on the device.
test.describe("ChatInbox on a Galaxy Fold cover screen", () => {
  test.use({ viewport: { width: 344, height: 900 } });

  test("fits 344px without spilling sideways", async ({ mount }) => {
    const component = await mount(harness());

    // Sanity: the app stylesheet actually loaded, otherwise this would
    // be screenshotting unstyled markup and catching nothing.
    const bg = await component
      .getByRole("button", { name: "New message" })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");

    // Nothing may spill past the viewport at the narrowest width we
    // support.
    const overflow = await component.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await expect(component).toHaveScreenshot("chat-inbox-344.png");
  });

  test("every row and control clears a 44px tap target", async ({ mount }) => {
    const component = await mount(harness());

    for (const name of ["New message", "New group"]) {
      const box = await component
        .getByRole("button", { name })
        .boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    const rows = component.getByRole("link");
    const count = await rows.count();
    expect(count).toBe(ROWS.length);
    for (let i = 0; i < count; i++) {
      const box = await rows.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

});

test.describe("ChatInbox on a desktop window", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("renders at desktop width", async ({ mount }) => {
    const component = await mount(harness());
    await expect(component).toHaveScreenshot("chat-inbox-desktop.png");
  });

  // Authenticated pages render dark, and raw SVG hex is not remapped
  // there. Every icon in the inbox strokes currentColor for exactly
  // that reason, so this is the capture that would catch a regression.
  test("renders in the dark theme", async ({ mount, page }) => {
    const component = await mount(harness());
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await expect(component).toHaveScreenshot("chat-inbox-desktop-dark.png");
  });
});
