# Native front door (PR 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the native app open on sign-in, ask for permissions only when it has earned them, keep the status bar readable on every page, make Back work, escalate a silent location-permission failure, and tidy the login page, all shipped with the web (no store build).

**Architecture:** Every fix is web-side. The native shell is a WKWebView/WebView loading taxottic.com, so a cookie the shell sets on first load lets the middleware redirect signed-out native launches to `/login`; a client fallback covers the very first load. Push registration moves behind two gates computed by a pure function. The status-bar band becomes a real element driven by one `data-bar` attribute the app header sets, with the plugin style reapplied on resize and attribute change. Back trusts the plugin's `canGoBack`. Each behaviour lives in a small pure module under `lib/native/` with unit tests, and the components that call them are pinned by source guards, following the repo's "test the call site" rule.

**Tech Stack:** Next.js 16 (App Router, `middleware.ts` delegating to `lib/supabase/middleware.ts`), React 19, Tailwind v4, Capacitor 8 (`@capacitor/core`, `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/push-notifications`), vitest, Playwright (component tests via `playwright-ct.config.ts`, e2e via `playwright.config.ts`).

Spec: `docs/superpowers/specs/2026-09-05-year-interface-design.md` section 4.5 (first screen, permission timing, top band) plus the 2026-09-14 audits (`/Users/technooptics/Desktop/TAXOTTIC-IOS-AUDIT-2026-09-14.md`, `TAXOTTIC-ANDROID-AUDIT-2026-09-14.md`): Back handling, status-bar reapply on configuration change, location recovery escalation, login order and one email flow, tap targets.

## Global Constraints

- No em dashes (U+2014) anywhere: code, comments, copy, commit messages, PR text. No emoji. Icons only from `components/ui/Icons`.
- Copy register: plain, specific, present tense. Never "calmer, gentle, gently, quietly, friendly, scary". Buttons say what happens ("Send code", "Open location settings").
- Nothing here needs a native build; every change must work on the installed binaries (Android versionCode 46, iOS 1.3.11 build 41). Native plugin calls stay behind `Capacitor.isPluginAvailable` and `.catch(() => {})`, as the existing code does.
- Web behaviour unchanged: every native branch is gated on `Capacitor.isNativePlatform()`; on the web the components stay inert.
- Both app themes: the app defaults light and dark is a stored preference (`html[data-theme="dark"]`); check any app surface in both.
- Tap targets: 44 CSS px minimum height on phones for every control this plan touches.
- Any client JS or markup change bumps `CACHE_VERSION` in `public/sw.js`, chosen against `origin/main` and every open PR at the moment of the bump, keeping every changelog entry (Task 8).
- Gates before every commit: `npx tsc --noEmit` clean; `npx eslint . --ignore-pattern 'playwright/.cache/**'` 0 errors and the warning count at its baseline (46); `npx vitest run` green; Playwright suites where a task names them.
- Commit messages end with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and nothing after it.
- Branch `feat/native-front-door`, worktree `/Users/technooptics/Projects/taxottic-wt/native-front-door`, stacked on `feat/year-home` (PR #633). Never use bare `git stash`.

---

### Task 1: Signed-out native launches land on /login

**Files:**
- Create: `lib/native/front-door.ts`, `lib/native/front-door.test.ts`, `components/NativeFrontDoor.tsx`
- Modify: `lib/supabase/middleware.ts` (after line 331, where `user` is resolved), `components/CapacitorNativeInit.tsx:46` (after the `isNativePlatform` check), `app/page.tsx:58` (mount)

**Interfaces:**
- Produces: `NATIVE_COOKIE = "taxottic_native"`; `frontDoorRedirect(input: { pathname: string; hasUser: boolean; nativeCookie: boolean }): "/login" | null`; `<NativeFrontDoor />` client component.

- [ ] **Step 1: Write the failing unit test**

```ts
// lib/native/front-door.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { frontDoorRedirect, NATIVE_COOKIE } from "./front-door";

describe("native front door", () => {
  it("sends a signed-out native launch of / to /login", () => {
    expect(frontDoorRedirect({ pathname: "/", hasUser: false, nativeCookie: true })).toBe("/login");
  });
  it("leaves the web, signed-in users and every other path alone", () => {
    expect(frontDoorRedirect({ pathname: "/", hasUser: false, nativeCookie: false })).toBeNull();
    expect(frontDoorRedirect({ pathname: "/", hasUser: true, nativeCookie: true })).toBeNull();
    expect(frontDoorRedirect({ pathname: "/pricing", hasUser: false, nativeCookie: true })).toBeNull();
  });
  it("is wired: the middleware reads the cookie and the init sets it", () => {
    const mw = readFileSync("lib/supabase/middleware.ts", "utf8");
    expect(mw).toMatch(/frontDoorRedirect\(\{/);
    expect(mw).toMatch(/request\.cookies\.get\(NATIVE_COOKIE\)/);
    const init = readFileSync("components/CapacitorNativeInit.tsx", "utf8");
    expect(init).toMatch(new RegExp(`document\\.cookie = \`\\$\\{NATIVE_COOKIE\\}=1`));
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).toMatch(/<NativeFrontDoor \/>/);
    expect(NATIVE_COOKIE).toBe("taxottic_native");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/native/front-door.test.ts`
Expected: FAIL, "Cannot find module './front-door'".

- [ ] **Step 3: Write the module**

```ts
// lib/native/front-door.ts
/**
 * The native shell's first screen.
 *
 * The shell loads taxottic.com, so a signed-out launch used to land on
 * the marketing page with Sign in as the third action (both 2026-09-14
 * audits, Critical). The server cannot tell a WebView from Safari, so
 * the shell marks itself: CapacitorNativeInit sets NATIVE_COOKIE on its
 * first run, and the middleware redirects a signed-out request for "/"
 * that carries it. The very first launch, before the cookie exists, is
 * covered by <NativeFrontDoor /> on the client.
 */
export const NATIVE_COOKIE = "taxottic_native";

export function frontDoorRedirect(input: {
  pathname: string;
  hasUser: boolean;
  nativeCookie: boolean;
}): "/login" | null {
  if (input.pathname !== "/") return null;
  if (input.hasUser) return null;
  return input.nativeCookie ? "/login" : null;
}
```

- [ ] **Step 4: Wire the middleware**

In `lib/supabase/middleware.ts`, add the import at the top: `import { frontDoorRedirect, NATIVE_COOKIE } from "@/lib/native/front-door";`. Immediately after the block ending at line 331 (`} = await supabase.auth.getUser();`), insert:

```ts
  // Native shell, signed out, at the root: the app's front door is
  // sign-in, not the marketing page. lib/native/front-door.ts.
  const frontDoor = frontDoorRedirect({
    pathname,
    hasUser: Boolean(user),
    nativeCookie: request.cookies.get(NATIVE_COOKIE)?.value === "1",
  });
  if (frontDoor) {
    const url = request.nextUrl.clone();
    url.pathname = frontDoor;
    url.search = "";
    return NextResponse.redirect(url, 307);
  }
```

- [ ] **Step 5: Set the cookie from the shell and mount the client fallback**

In `components/CapacitorNativeInit.tsx`, add `import { NATIVE_COOKIE } from "@/lib/native/front-door";` and, right after line 46 (`if (!Capacitor?.isNativePlatform()) return;`):

```ts
      // Mark the shell for the server (lib/native/front-door.ts). One
      // year, Lax, Secure: the WebView loads https://taxottic.com.
      document.cookie = `${NATIVE_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
```

Create `components/NativeFrontDoor.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Client half of the native front door. app/page.tsx only renders for
 * signed-out visitors (signed-in ones are redirected server-side), so on
 * the native shell this page is always the wrong first screen. The
 * middleware handles every launch after the first; this covers the first,
 * before the shell's cookie exists.
 */
export function NativeFrontDoor() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    import("@capacitor/core")
      .then(({ Capacitor }) => {
        if (!cancelled && Capacitor.isNativePlatform()) router.replace("/login");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
```

In `app/page.tsx`, import it and render `<NativeFrontDoor />` as the first child of `<main>` (before `<JsonLd ...>`).

- [ ] **Step 6: Run the test and the gates**

Run: `npx vitest run lib/native/front-door.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean. Then mutation-test: remove the `if (frontDoor)` block from the middleware, run the test, watch "is wired" fail, restore.

- [ ] **Step 7: Commit**

```bash
git add lib/native/front-door.ts lib/native/front-door.test.ts components/NativeFrontDoor.tsx lib/supabase/middleware.ts components/CapacitorNativeInit.tsx app/page.tsx
git commit -m "Native launches open on sign-in, not the marketing page"
```

---

### Task 2: Push registration waits for a session and a first visit to Today

**Files:**
- Create: `lib/native/push-gate.ts`, `lib/native/push-gate.test.ts`, `lib/native/reached-today.ts`, `components/MarkReachedToday.tsx`
- Modify: `components/CapacitorNativeInit.tsx:289-310` (the permission and register block), `app/dashboard/page.tsx:898` (mount next to `<TrialBanner />`)

**Interfaces:**
- Produces: `pushDecision(input: { hasSession: boolean; reachedToday: boolean; receive: "prompt" | "prompt-with-rationale" | "granted" | "denied"; pushEnabled: boolean }): { prompt: boolean; register: boolean; report: string }`; `REACHED_TODAY_KEY = "taxottic.native.reached_today"`; `REACHED_TODAY_EVENT = "taxottic:reached-today"`; `markReachedToday(): void`; `hasReachedToday(): boolean`.

- [ ] **Step 1: Write the failing unit test**

```ts
// lib/native/push-gate.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pushDecision } from "./push-gate";

const base = { hasSession: true, reachedToday: true, receive: "prompt" as const, pushEnabled: true };

describe("push gate", () => {
  it("never prompts before a session and a first visit to Today", () => {
    expect(pushDecision({ ...base, hasSession: false })).toEqual({ prompt: false, register: false, report: "gated_no_session" });
    expect(pushDecision({ ...base, reachedToday: false })).toEqual({ prompt: false, register: false, report: "gated_before_today" });
  });
  it("prompts once both gates are open and the OS can still ask", () => {
    expect(pushDecision(base)).toEqual({ prompt: true, register: false, report: "prompting" });
    expect(pushDecision({ ...base, receive: "prompt-with-rationale" }).prompt).toBe(true);
  });
  it("never asks again after a denial, and registers only when granted and enabled", () => {
    expect(pushDecision({ ...base, receive: "denied" })).toEqual({ prompt: false, register: false, report: "permission_denied" });
    expect(pushDecision({ ...base, receive: "granted" })).toEqual({ prompt: false, register: true, report: "register_called" });
    expect(pushDecision({ ...base, receive: "granted", pushEnabled: false })).toEqual({ prompt: false, register: false, report: "flag_disabled" });
  });
  it("is wired: the init decides before it prompts, and Today marks itself", () => {
    const init = readFileSync("components/CapacitorNativeInit.tsx", "utf8").replace(/\/\/.*$/gm, "");
    const decide = init.indexOf("pushDecision(");
    const prompt = init.indexOf("requestPermissions()");
    expect(decide).toBeGreaterThan(-1);
    expect(prompt).toBeGreaterThan(decide);
    expect(init).toMatch(/if \(decision\.prompt\)/);
    expect(init).toMatch(/if \(decision\.register\)/);
    expect(init).toMatch(/addEventListener\(REACHED_TODAY_EVENT/);
    expect(readFileSync("app/dashboard/page.tsx", "utf8")).toMatch(/<MarkReachedToday \/>/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/native/push-gate.test.ts`
Expected: FAIL, "Cannot find module './push-gate'".

- [ ] **Step 3: Write the modules**

```ts
// lib/native/push-gate.ts
/**
 * When the app may ask for notifications.
 *
 * Android grants an app two prompts and then blocks it (POST_NOTIFICATIONS
 * USER_FIXED), and the old init asked on every cold start, on the
 * marketing page, before sign-in: both prompts were spent on a visitor who
 * had not seen the product (Android audit C2, iOS audit I1). The spec
 * (4.5) puts the ask behind two gates: a session exists, and the user has
 * reached Today once. A denial is final for this install; the OS owns it.
 */
export type Receive = "prompt" | "prompt-with-rationale" | "granted" | "denied";

export function pushDecision(input: {
  hasSession: boolean;
  reachedToday: boolean;
  receive: Receive;
  pushEnabled: boolean;
}): { prompt: boolean; register: boolean; report: string } {
  if (!input.hasSession) return { prompt: false, register: false, report: "gated_no_session" };
  if (!input.reachedToday) return { prompt: false, register: false, report: "gated_before_today" };
  if (input.receive === "denied") return { prompt: false, register: false, report: "permission_denied" };
  if (input.receive === "granted") {
    return input.pushEnabled
      ? { prompt: false, register: true, report: "register_called" }
      : { prompt: false, register: false, report: "flag_disabled" };
  }
  return { prompt: true, register: false, report: "prompting" };
}
```

```ts
// lib/native/reached-today.ts
export const REACHED_TODAY_KEY = "taxottic.native.reached_today";
export const REACHED_TODAY_EVENT = "taxottic:reached-today";

/** Called by the dashboard on mount; the init listens for the event. */
export function markReachedToday(): void {
  try {
    if (localStorage.getItem(REACHED_TODAY_KEY) === "1") return;
    localStorage.setItem(REACHED_TODAY_KEY, "1");
  } catch {
    /* storage unavailable: the event still fires for this session */
  }
  window.dispatchEvent(new Event(REACHED_TODAY_EVENT));
}

export function hasReachedToday(): boolean {
  try {
    return localStorage.getItem(REACHED_TODAY_KEY) === "1";
  } catch {
    return false;
  }
}
```

```tsx
// components/MarkReachedToday.tsx
"use client";

import { useEffect } from "react";
import { markReachedToday } from "@/lib/native/reached-today";

/** Mounted on the dashboard: the second gate for the notification prompt. */
export function MarkReachedToday() {
  useEffect(() => {
    markReachedToday();
  }, []);
  return null;
}
```

- [ ] **Step 4: Rewire the init**

In `components/CapacitorNativeInit.tsx`, add imports: `import { pushDecision } from "@/lib/native/push-gate";` and `import { hasReachedToday, REACHED_TODAY_EVENT } from "@/lib/native/reached-today";`. Replace lines 289 to 310 (from `const perm = await PushNotifications.checkPermissions();` through the `await PushNotifications.register();` block's closing `}`) with a function that can run now and again when Today is reached:

```ts
          const runPushGate = async () => {
            let hasSession = false;
            try {
              const { createClient } = await import("@/lib/supabase/client");
              const { data } = await createClient().auth.getSession();
              hasSession = Boolean(data.session);
            } catch {
              /* no client: treat as signed out */
            }
            const perm = await PushNotifications.checkPermissions();
            const decision = pushDecision({
              hasSession,
              reachedToday: hasReachedToday(),
              receive: perm.receive as Receive,
              pushEnabled: process.env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "1",
            });
            reportPush(decision.report, `receive=${perm.receive}`);
            if (decision.prompt) {
              const asked = await PushNotifications.requestPermissions();
              const after = pushDecision({
                hasSession,
                reachedToday: true,
                receive: asked.receive as Receive,
                pushEnabled: process.env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "1",
              });
              reportPush(after.report, `receive=${asked.receive}`);
              if (after.register) await PushNotifications.register();
              return;
            }
            if (decision.register) await PushNotifications.register();
          };
          await runPushGate();
          window.addEventListener(REACHED_TODAY_EVENT, () => {
            void runPushGate().catch(() => {});
          });
```

Import the `Receive` type: `import { pushDecision, type Receive } from "@/lib/native/push-gate";`. Keep the `reportPush("plugin_unavailable")` and the listener registrations above it unchanged.

In `app/dashboard/page.tsx`, import `MarkReachedToday` and render `<MarkReachedToday />` immediately before `<TrialBanner trial={trial} />` (line 898).

- [ ] **Step 5: Run the tests and gates, then mutation-test**

Run: `npx vitest run lib/native/push-gate.test.ts && npx tsc --noEmit`
Expected: PASS. Mutation: swap the order so `requestPermissions()` runs before `pushDecision(` in the init; "is wired" fails; restore.

- [ ] **Step 6: Commit**

```bash
git add lib/native/push-gate.ts lib/native/push-gate.test.ts lib/native/reached-today.ts components/MarkReachedToday.tsx components/CapacitorNativeInit.tsx app/dashboard/page.tsx
git commit -m "Notifications are asked for after sign-in and a first visit to Today, never after a denial"
```

---

### Task 3: The status-bar band and style follow the page

**Files:**
- Create: `lib/native/status-bar.ts`, `lib/native/status-bar.test.ts`, `components/StatusBarBand.tsx`, `components/NavyBar.tsx`, `components/StatusBarBand.ct.spec.tsx`
- Modify: `app/globals.css:709-719` (delete the first `body::before` rule, add the band rules; the `html[data-theme="dark"] body::before` override stays), `lib/marketing/marketing-skin.test.ts` (its allowlist names `CapacitorNativeInit.tsx` for the literal `#2a3a5e`, which this task deletes), `app/layout.tsx:295-302` (mount the band as the first child of `<body>`), `components/AppHeader.tsx` (render `<NavyBar />`; it is an async server component, so the attribute is set by that client child), `components/CapacitorNativeInit.tsx:61-75` and `:135-139` (style and colour from the page, reapplied)

**Interfaces:**
- Produces: `type Bar = "paper" | "navy"`; `barOf(root: { dataset: { bar?: string } }): Bar`; `statusBarPlan(bar: Bar, theme: "light" | "dark"): { style: "Light" | "Dark"; color: string }`; `<StatusBarBand />`.

- [ ] **Step 1: Write the failing unit test**

```ts
// lib/native/status-bar.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { barOf, statusBarPlan } from "./status-bar";

describe("status bar follows the page", () => {
  it("paper pages get dark glyphs on the page ground; navy pages get light glyphs on navy", () => {
    expect(statusBarPlan("paper", "light")).toEqual({ style: "Light", color: "#f2f5f8" });
    expect(statusBarPlan("paper", "dark")).toEqual({ style: "Dark", color: "#0c1017" });
    expect(statusBarPlan("navy", "light")).toEqual({ style: "Dark", color: "#121a2a" });
    expect(statusBarPlan("navy", "dark")).toEqual({ style: "Dark", color: "#121a2a" });
  });
  it("reads the attribute the app header sets and defaults to paper", () => {
    expect(barOf({ dataset: { bar: "navy" } })).toBe("navy");
    expect(barOf({ dataset: {} })).toBe("paper");
  });
  it("is wired: one band element, no body::before band, the header sets the attribute, the init reapplies", () => {
    const css = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.match(/^body::before\s*\{/gm)?.length ?? 0, "only the ambient backdrop remains").toBe(1);
    expect(css).toMatch(/#status-bar-band\s*\{/);
    expect(css).toMatch(/html\[data-bar="navy"\]\s*\{\s*--status-band:\s*#121a2a/);
    expect(readFileSync("app/layout.tsx", "utf8")).toMatch(/<StatusBarBand \/>/);
    expect(readFileSync("components/AppHeader.tsx", "utf8")).toMatch(/<NavyBar \/>/);
    const navy = readFileSync("components/NavyBar.tsx", "utf8");
    expect(navy).toMatch(/dataset\.bar = "navy"/);
    expect(navy).toMatch(/delete document\.documentElement\.dataset\.bar/);
    const init = readFileSync("components/CapacitorNativeInit.tsx", "utf8");
    expect(init).toMatch(/statusBarPlan\(/);
    expect(init).toMatch(/addEventListener\("resize", applyStatusBar/);
    expect(init).toMatch(/new MutationObserver\(applyStatusBar\)/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/native/status-bar.test.ts`
Expected: FAIL, "Cannot find module './status-bar'".

- [ ] **Step 3: Write the module and the band**

```ts
// lib/native/status-bar.ts
/**
 * What the status bar should look like on this page.
 *
 * Both audits measured the clock at about 1.1:1 on light pages: the shell
 * forced light glyphs everywhere, and the navy band meant to sit behind
 * them was a second `body::before` rule that the ambient backdrop's own
 * `body::before` overrode (iOS C1, Android I1). The band is now a real
 * element, its colour and the plugin's style come from one attribute the
 * app header sets, and Android reapplies on every configuration change
 * (a fold left the bar unreadable until force-stop, Android C4).
 */
export type Bar = "paper" | "navy";

export function barOf(root: { dataset: { bar?: string } }): Bar {
  return root.dataset.bar === "navy" ? "navy" : "paper";
}

/** `style` is the @capacitor/status-bar Style name: Light means dark glyphs. */
export function statusBarPlan(bar: Bar, theme: "light" | "dark"): { style: "Light" | "Dark"; color: string } {
  if (bar === "navy") return { style: "Dark", color: "#121a2a" };
  return theme === "dark" ? { style: "Dark", color: "#0c1017" } : { style: "Light", color: "#f2f5f8" };
}
```

```tsx
// components/StatusBarBand.tsx
/**
 * The strip under the OS status bar on the native shell. Zero height on
 * the web (no safe-area inset). Colour comes from --status-band, which
 * html[data-bar="navy"] sets; see lib/native/status-bar.ts.
 */
export function StatusBarBand() {
  return <div id="status-bar-band" aria-hidden="true" />;
}
```

In `app/globals.css`, delete the whole rule at lines 709 to 719 (`body::before { content: ""; position: fixed; top: 0; ... z-index: 20; pointer-events: none; }`) and its comment block above it, and add in its place:

```css
/* The strip under the OS status bar on the native shell. One element,
   one attribute: html[data-bar="navy"] is set by the app header while it
   is mounted; every other page is paper. lib/native/status-bar.ts holds
   the plugin side. Zero height on the web. */
#status-bar-band {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px));
  background: var(--status-band, var(--background));
  z-index: 20;
  pointer-events: none;
}
html[data-bar="navy"] { --status-band: #121a2a; }
```

In `app/layout.tsx`, import `StatusBarBand` and render `<StatusBarBand />` as the first child inside `<body ...>` (before `<CapacitorAuth />`).

Create `components/NavyBar.tsx` and render `<NavyBar />` as the first child inside AppHeader's `<header ...>` element (`components/AppHeader.tsx`, the `<header className="app-header fixed ..."` at about line 257). AppHeader is an async server component, so the attribute is set by this client child:

```tsx
// components/NavyBar.tsx
"use client";

import { useEffect } from "react";

/** While the navy app header is on screen, the status bar is navy too. */
export function NavyBar() {
  useEffect(() => {
    document.documentElement.dataset.bar = "navy";
    return () => {
      delete document.documentElement.dataset.bar;
    };
  }, []);
  return null;
}
```

- [ ] **Step 4: Rewire the init**

In `components/CapacitorNativeInit.tsx`, import `{ barOf, statusBarPlan } from "@/lib/native/status-bar"`. Replace line 74 (`await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});`) with:

```ts
          const applyStatusBar = () => {
            const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
            const plan = statusBarPlan(barOf(document.documentElement), theme);
            void StatusBar.setStyle({ style: plan.style === "Dark" ? Style.Dark : Style.Light }).catch(() => {});
            if (isAndroid) void StatusBar.setBackgroundColor({ color: plan.color }).catch(() => {});
          };
          applyStatusBar();
          window.addEventListener("resize", applyStatusBar);
          window.addEventListener("orientationchange", applyStatusBar);
          document.addEventListener("visibilitychange", applyStatusBar);
          new MutationObserver(applyStatusBar).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-bar", "data-theme"],
          });
```

and delete lines 135 to 139 (`await StatusBar.setBackgroundColor({ color: "#2a3a5e" }).catch(() => {});` and its comment), since `applyStatusBar` now owns the colour. Keep the `overlaying` measurement that follows.

- [ ] **Step 5: Write the rendered guard**

```tsx
// components/StatusBarBand.ct.spec.tsx
import { test, expect } from "@playwright/experimental-ct-react";
import { StatusBarBand } from "./StatusBarBand";

test.describe("status bar band", () => {
  test("paints the page ground on paper and navy under the app header", async ({ mount, page }) => {
    await mount(
      <div data-skin="instrument" style={{ ["--app-safe-top" as string]: "44px" }}>
        <StatusBarBand />
      </div>,
    );
    const band = page.locator("#status-bar-band");
    await expect(band).toHaveCSS("height", "44px");
    await expect(band).toHaveCSS("background-color", "rgb(242, 245, 248)");
    await page.evaluate(() => {
      document.documentElement.dataset.bar = "navy";
    });
    await expect(band).toHaveCSS("background-color", "rgb(18, 26, 42)");
  });
});
```

Run: `npx playwright test -c playwright-ct.config.ts components/StatusBarBand.ct.spec.tsx`
Expected: PASS on both projects. (The harness imports app/globals.css; `--app-safe-top` is set inline because the harness has no native inset.)

- [ ] **Step 6: Run the unit test and gates; mutation-test**

Run: `npx vitest run lib/native/status-bar.test.ts && npx tsc --noEmit`
Expected: PASS. Mutation: re-add a second `body::before { }` rule to globals.css; the "only the ambient backdrop remains" assertion fails; remove it.

- [ ] **Step 7: Commit**

```bash
git add lib/native/status-bar.ts lib/native/status-bar.test.ts components/StatusBarBand.tsx components/NavyBar.tsx components/StatusBarBand.ct.spec.tsx app/globals.css app/layout.tsx components/AppHeader.tsx components/CapacitorNativeInit.tsx
git commit -m "The status bar reads on every page: one band, one attribute, reapplied on every configuration change"
```

---

### Task 4: Back exits when there is nowhere to go back to

**Files:**
- Create: `lib/native/back-action.ts`, `lib/native/back-action.test.ts`
- Modify: `components/EdgeSwipeBack.tsx:91-97`

**Interfaces:**
- Produces: `backAction(canGoBack: boolean): "back" | "exit"`.

- [ ] **Step 1: Write the failing unit test**

```ts
// lib/native/back-action.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { backAction } from "./back-action";

describe("system Back", () => {
  it("goes back when the WebView can, and exits when it cannot", () => {
    expect(backAction(true)).toBe("back");
    expect(backAction(false)).toBe("exit");
  });
  it("is wired: the listener trusts canGoBack and never reads history.length", () => {
    const src = readFileSync("components/EdgeSwipeBack.tsx", "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const listener = src.slice(src.indexOf('"backButton"'));
    expect(listener).toMatch(/backAction\(canGoBack\)/);
    expect(listener).not.toMatch(/history\.length/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/native/back-action.test.ts`
Expected: FAIL, "Cannot find module './back-action'".

- [ ] **Step 3: Write the module and rewire the listener**

```ts
// lib/native/back-action.ts
/**
 * Android's system Back. The plugin reports canGoBack from the WebView's
 * own history; the old handler also accepted `window.history.length > 1`,
 * which a single-page app never lets fall to 1, so Back at the root did
 * nothing (Android audit C3: five presses, activity still resumed).
 */
export function backAction(canGoBack: boolean): "back" | "exit" {
  return canGoBack ? "back" : "exit";
}
```

In `components/EdgeSwipeBack.tsx`, import `{ backAction } from "@/lib/native/back-action"` and replace lines 91 to 97 with:

```ts
        const h = await App.addListener("backButton", ({ canGoBack }) => {
          if (backAction(canGoBack) === "back") {
            window.history.back();
          } else {
            void App.exitApp();
          }
        });
```

Leave the edge-swipe gesture (line 64) as it is: a swipe at the root doing nothing is correct.

- [ ] **Step 4: Run the test and gates; mutation-test**

Run: `npx vitest run lib/native/back-action.test.ts && npx tsc --noEmit`
Expected: PASS. Mutation: put `|| window.history.length > 1` back; "is wired" fails; restore.

- [ ] **Step 5: Commit**

```bash
git add lib/native/back-action.ts lib/native/back-action.test.ts components/EdgeSwipeBack.tsx
git commit -m "System Back exits the app when the WebView has nowhere to go back to"
```

---

### Task 5: A downgraded location permission blocks, escalates and is counted

**Files:**
- Modify: `lib/mileage/self-repair.ts:254-262` (a capped location repair reports `blocked`), `lib/mileage/self-repair.test.ts` (extend), `components/mileage/AutoTrackToggle.tsx` (reads off with the cause while the OS says While Using), `app/dashboard/page.tsx` (a strip when the viewer's own phone reports While Using), `components/mileage/TrackingHealthBanner.tsx:36-48` (copy)
- Create: `components/mileage/LocationBlockedStrip.tsx`, `lib/mileage/location-blocked.ts`, `lib/mileage/location-blocked.test.ts`

**Interfaces:**
- Produces: `locationBlocked(status: { locationAuthorization: string | null; trackingEnabled: boolean | null } | null): { blocked: boolean; short: string; fix: string } | null`; self-repair state string `location_always:blocked` after the cap.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/mileage/location-blocked.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { locationBlocked } from "./location-blocked";

describe("location blocked", () => {
  it("names While Using as a block with the fix, and nothing otherwise", () => {
    expect(locationBlocked({ locationAuthorization: "whenInUse", trackingEnabled: true })).toEqual({
      blocked: true,
      short: "Location is While Using, so drives are not recorded off screen",
      fix: "Settings, Taxottic, Location, Always",
    });
    expect(locationBlocked({ locationAuthorization: "always", trackingEnabled: true })).toBeNull();
    expect(locationBlocked(null)).toBeNull();
  });
  it("is wired: the dashboard renders the strip and the toggle reads the block", () => {
    expect(readFileSync("app/dashboard/page.tsx", "utf8")).toMatch(/<LocationBlockedStrip/);
    expect(readFileSync("components/mileage/AutoTrackToggle.tsx", "utf8")).toMatch(/locationBlocked\(/);
  });
});
```

Append to `lib/mileage/self-repair.test.ts`, inside the describe "the attempt cap, which is what stops a repair becoming a loop" (line 176), a case written in that describe's own style (read its neighbours: they build a status with the file's helpers, seed a ledger at `MAX_REPAIR_ATTEMPTS` for one repair id, call `runSelfRepairs` the same way line 87 does, and assert on the returned states):

```ts
  it("reports location_always:blocked once the attempt cap is reached, and geofence still waits", async () => {
    // Same setup as the capped-attempts case above this one, with the
    // ledger's location_always.attempts at MAX_REPAIR_ATTEMPTS.
    // ...build status and ledger exactly as the neighbouring case does...
    expect(out.states).toContain("location_always:blocked");
    expect(out.states).not.toContain("location_always:waiting");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/mileage/location-blocked.test.ts lib/mileage/self-repair.test.ts`
Expected: FAIL, missing module and the new state absent.

- [ ] **Step 3: Implement**

```ts
// lib/mileage/location-blocked.ts
/**
 * A permission the phone has already diagnosed. iOS moved one driver from
 * Always to While Using on 2026-08-20 and nothing recorded for 20 days
 * while the self-repair sat in location_always:waiting (iOS audit C4).
 * The state is now blocking: the dashboard says so, the tracking toggle
 * cannot read on, and the manager card counts the attempts.
 */
export function locationBlocked(
  status: { locationAuthorization: string | null; trackingEnabled: boolean | null } | null,
): { blocked: boolean; short: string; fix: string } | null {
  if (!status || status.locationAuthorization !== "whenInUse") return null;
  return {
    blocked: true,
    short: "Location is While Using, so drives are not recorded off screen",
    fix: "Settings, Taxottic, Location, Always",
  };
}
```

In `lib/mileage/self-repair.ts`, in the block at lines 254 to 262 where `attempts >= MAX_REPAIR_ATTEMPTS` pushes `${id}:waiting`, push `${id}:blocked` instead when `id === "location_always"` (geofence keeps `waiting`), and add to the file's header comment one line: "location_always past the cap reports `blocked`, which the dashboard and the manager card surface; `waiting` is reserved for backoff."

```tsx
// components/mileage/LocationBlockedStrip.tsx
import Link from "next/link";
import { WarningIcon } from "@/components/ui/Icons";

/** Dashboard strip for the viewer's own phone when its permission blocks capture. */
export function LocationBlockedStrip({ short, fix }: { short: string; fix: string }) {
  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50/60 p-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <WarningIcon className="size-4 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{short}.</p>
          <p className="mt-1 text-xs">{fix}.</p>
          <Link href="/mileage" className="btn-primary mt-3 inline-flex min-h-11 items-center text-xs">
            Open location settings
          </Link>
        </div>
      </div>
    </div>
  );
}
```

In `app/dashboard/page.tsx`, where the page already loads the viewer's `mileage_device_status` row (search for `mileage_device_status`; if the dashboard does not load it, add a select of `location_authorization, tracking_enabled` for the current user and company, following the query style used elsewhere in the page), compute `const blocked = locationBlocked(deviceStatus)` and render `{blocked ? <LocationBlockedStrip short={blocked.short} fix={blocked.fix} /> : null}` directly under `<MarkReachedToday />`. Both themes: the strip carries `dark:` variants above.

In `components/mileage/AutoTrackToggle.tsx`, where the toggle computes its displayed state, import `locationBlocked` and, when the device status it already watches (`onLocationAuthorization`-style callback at `lib/mileage/device-status.ts:558`) reports `whenInUse`, render the toggle off with the caption `locationBlocked(...)!.short` and the button "Open location settings" (calls `openLocationSettings` from `lib/mileage/native-tracker`) instead of the on/off control. Read the component before editing; keep its existing web fallback.

In `components/mileage/TrackingHealthBanner.tsx` lines 36 to 48, the fix paragraph loses "Then toggle tracking off and back on" (the toggle now reflects the OS), and the button `className` gains `min-h-11`.

- [ ] **Step 4: Run the tests and gates; both themes**

Run: `npx vitest run lib/mileage && npx tsc --noEmit`, then mount `LocationBlockedStrip` in the component harness under `data-theme="dark"` and `light` (add a two-case CT spec `components/mileage/LocationBlockedStrip.ct.spec.tsx` asserting the text colour contrast against the background is at least 4.5:1 in both, reusing the contrast helper `components/TrialBanner.ct.spec.tsx` uses).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mileage/location-blocked.ts lib/mileage/location-blocked.test.ts lib/mileage/self-repair.ts lib/mileage/self-repair.test.ts components/mileage/LocationBlockedStrip.tsx components/mileage/LocationBlockedStrip.ct.spec.tsx components/mileage/AutoTrackToggle.tsx components/mileage/TrackingHealthBanner.tsx app/dashboard/page.tsx
git commit -m "A location permission that stops capture blocks the toggle, names itself on Today and stops pretending to wait"
```

---

### Task 6: The login page: passkey first, Apple and Google, one email flow, 44px targets

**Files:**
- Modify: `app/login/page.tsx:399-432` (provider order), `:433-448` (passkey and dividers), `:500-517` (button copy and the code-entry link), `e2e/login-flow.spec.ts` (order and targets)

**Interfaces:**
- Consumes: `PasskeySignInButton`, `SsoGlyph`, `HumanCheck` as already imported.

- [ ] **Step 1: Extend the e2e spec first**

Append to `e2e/login-flow.spec.ts` (read its existing `test.describe` and helpers; place inside them):

```ts
  test("offers passkey first, then Apple and Google, and every control is 44px tall on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto("/login");
    const order = await page.locator(".card button, .card a[role=button]").evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).innerText.trim()).filter(Boolean).slice(0, 4),
    );
    expect(order[0]).toMatch(/passkey/i);
    expect(order[1]).toMatch(/Apple/);
    expect(order[2]).toMatch(/Google/);
    const short = await page.locator(".card button, .card a").evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().height < 44).map((e) => (e as HTMLElement).innerText.trim()),
    );
    expect(short, "every visible control is at least 44px tall").toEqual([]);
    await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Microsoft/ })).not.toBeInViewport();
  });
```

Run: `npx playwright test e2e/login-flow.spec.ts -g "passkey first"`
Expected: FAIL (order is Google, Microsoft, Apple; the code link is 16px; the button says "Send magic link").

- [ ] **Step 2: Reorder and reword**

In `app/login/page.tsx`:

1. Move `<PasskeySignInButton emailHint={email || undefined} />` (line 434) to the top of the card, before the provider grid, and give the grid this order: Apple, Google, then Microsoft wrapped in `<div className="hidden sm:block">` plus a phone-only disclosure after the email form:

```tsx
            <details className="sm:hidden mt-3">
              <summary className="min-h-11 flex items-center text-sm text-ink-soft cursor-pointer">More ways to sign in</summary>
              <button onClick={() => oauth("azure")} className="btn-ghost w-full min-h-11 mt-2" aria-label="Continue with Microsoft">
                <SsoGlyph kind="microsoft" />
                <span>Continue with Microsoft</span>
              </button>
            </details>
```

2. Every `btn-ghost w-full` in the provider grid gains `min-h-11`.
3. The first divider text becomes `or continue with` and the second stays `or email`.
4. The submit button label: `{status === "sending" ? "Sending code" : "Send code"}`; the sent copy at line 519 becomes `"We sent a 6-digit code to your email. Enter it below."`.
5. The "Have a sign-in code? Enter it" link becomes a button with `className="mt-3 w-full min-h-11 text-sm text-ink-soft hover:text-forest-900 underline underline-offset-2"` and the text `Have a code already? Enter it` (this path stays: the store-review account signs in with a fixed code and no email).
6. `HumanCheck` and the email `input` keep their classes; add `min-h-11` to the input.

- [ ] **Step 3: Run the spec and the full login suite**

Run: `npx playwright test e2e/login-flow.spec.ts`
Expected: PASS on both projects (update any existing assertion that named "Send magic link" to "Send code").

- [ ] **Step 4: Commit**

```bash
git add app/login/page.tsx e2e/login-flow.spec.ts
git commit -m "Sign in leads with passkey, sends a code, and every control is a full tap target"
```

---

### Task 7: Headers stop touching their buttons, and the switch and account control are tap-sized

**Files:**
- Modify: `app/example/page.tsx:105-150` (the sample page's own header: gap, wordmark shrink, Sign in link height), `components/AppHeader.tsx` (the content row: `gap-3`, wordmark wrapper `min-w-0`), `components/UserMenu.tsx` (the trigger is 44x44), `app/globals.css` (`.audience-seg` min-height 44px), `components/AudienceToggle.ct.spec.tsx` (height assertion), `e2e/mobile-responsive.spec.ts` (sample header gap and target at 344)
- Create: `components/UserMenu.ct.spec.tsx`

- [ ] **Step 1: Write the failing rendered guards**

Append to `components/AudienceToggle.ct.spec.tsx` inside its describe:

```tsx
  test("every segment is at least 44px tall on a phone", async ({ mount, page }) => {
    await page.setViewportSize({ width: 344, height: 700 });
    await mount(
      <div data-skin="instrument">
        <AudienceToggle current="personal" />
      </div>,
    );
    const heights = await page.getByRole("tab").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });
```

```tsx
// components/UserMenu.ct.spec.tsx
import { test, expect } from "@playwright/experimental-ct-react";
import { UserMenu } from "./UserMenu";

test("the account control is a 44x44 target", async ({ mount, page }) => {
  await page.setViewportSize({ width: 344, height: 700 });
  // Read UserMenu's props (components/UserMenu.tsx:124) and pass the
  // minimal set it requires; do not weaken the assertion.
  await mount(
    <div data-skin="instrument">
      <UserMenu />
    </div>,
  );
  const box = await page.getByRole("button").first().boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
});
```

Append to `e2e/mobile-responsive.spec.ts` (inside its describe; it already visits public pages at phone widths):

```ts
  test("the sample page header at 344: the wordmark and Sign in never touch, and Sign in is 44px tall", async ({ page }) => {
    await page.setViewportSize({ width: 344, height: 700 });
    await page.goto("/example");
    const mark = await page.locator("header a").first().boundingBox();
    const signIn = await page.locator('header a[href="/login"]').first().boundingBox();
    expect(mark && signIn && signIn.x - (mark.x + mark.width)).toBeGreaterThanOrEqual(8);
    expect(signIn?.height).toBeGreaterThanOrEqual(44);
  });
```

Run: `npx playwright test -c playwright-ct.config.ts components/AudienceToggle.ct.spec.tsx components/UserMenu.ct.spec.tsx` and `npx playwright test e2e/mobile-responsive.spec.ts -g "sample page header"`
Expected: FAIL (segments about 30px; the sample header gap is 0 at 344; the trigger is smaller than 44).

- [ ] **Step 2: Implement**

In `app/globals.css`, under the `.audience-seg` rule add `min-height: 44px; display: inline-flex; align-items: center;` (keep the padding).

In `app/example/page.tsx` lines 105 to 150: the header row gets `gap-3`, the wordmark wrapper `min-w-0 shrink` with `max-w-[52vw] sm:max-w-none`, and the Sign in link `min-h-11 inline-flex items-center`.

In `components/AppHeader.tsx`: the content row gets `gap-3`, and the wordmark's wrapper `min-w-0 shrink`.

In `components/UserMenu.tsx`: the trigger button gets `size-11 grid place-items-center` (44px) with its icon kept at `size-5`; keep every other class.

- [ ] **Step 3: Run the guards, the whole component suite, and both themes**

Run: `npx playwright test -c playwright-ct.config.ts` and `npx playwright test e2e/mobile-responsive.spec.ts`
Expected: PASS; no existing component snapshot changes (`git status --short __ct-snapshots__` empty). Mount UserMenu under `data-theme="dark"` too and confirm the trigger renders (add the dark case to the new spec).

- [ ] **Step 4: Commit**

```bash
git add app/example/page.tsx components/AppHeader.tsx components/UserMenu.tsx components/UserMenu.ct.spec.tsx components/AudienceToggle.ct.spec.tsx e2e/mobile-responsive.spec.ts app/globals.css
git commit -m "Headers keep a gap from their buttons; the switch and the account control are tap-sized"
```

---

### Task 8: Service worker bump, gates, screenshots, PR

**Files:**
- Modify: `public/sw.js` (changelog entry and `CACHE_VERSION`)

- [ ] **Step 1: Bump the worker**

Survey: `git show origin/main:public/sw.js | grep -o 'CACHE_VERSION = "v[0-9]*"'` and the same for every open PR's head branch (`gh pr list --state open`). Take the next number after the highest (this branch is on v206 from #633; expect v207 unless another PR took it). Add the entry above the constant in the style of v206: what changed (front door, push gates, the status-bar band element, Back, the location strip, the login page, header sizes) and why the bump is needed (new client components, changed markup on the dashboard and login).

- [ ] **Step 2: Gates**

Run, in order, and paste each tail into the report: `npx tsc --noEmit`; `npx eslint . --ignore-pattern 'playwright/.cache/**' 2>&1 | tail -2` (0 errors, 46 warnings); `npx vitest run 2>&1 | tail -6`; `npx playwright test -c playwright-ct.config.ts 2>&1 | tail -3`; `npx playwright test --workers=1 2>&1 | tail -25`. The visual suite's home test is a known intermittent on CI (two failures in four runs on #633, both about 3% of pixels, artifact upload now in place); locally it must pass.

- [ ] **Step 3: Screenshots for the owner**

With `rm -rf .next && npx next dev -p 3400`: `/login` and `/example` at 375 and 344 (light); the dashboard cannot be signed into, so mount `LocationBlockedStrip` and `UserMenu` in the component harness and screenshot them at 344 in both themes; save under `.superpowers/sdd/<plan>/shots/`. Stop the server.

- [ ] **Step 4: Commit and push**

```bash
git add public/sw.js
git commit -m "Native front door: SW v207"
git push -u origin feat/native-front-door
```

- [ ] **Step 5: Open the PR**

Body written to `.superpowers/pr4a-body.md` (gitignored): stacked on #633 (say so in the first paragraph); one paragraph per task with the audit finding it closes (iOS C1, C2, C5 web half, I1, I5, I10; Android C1, C2, C3, C4, I1, I5, I9, I10; spec 4.5); the guards and their mutation evidence; the gates with numbers; the SW number and how it was chosen; the closing line "The harness asks for a Generated with Claude Code footer on PR bodies; the repo's writing rules take precedence, so it is omitted." No emoji, no em dashes.

```bash
gh pr create --base main --title "The native front door: sign-in first, permissions earned, a readable status bar, Back that works (SW v207)" --body-file .superpowers/pr4a-body.md
```

The owner merges.

---

## Self-review against the spec and the audits

- 4.5 first screen: Task 1. Permission timing: Task 2 (session and Today gates; never after a denial). Top band follows the page and the iOS style follows: Task 3, plus the Android reapply on configuration change (Android C4) and the CSS collision (iOS C1, I3).
- Back (Android C3): Task 4. The iOS gesture (C5) needs Swift and is PR 5.
- Location recovery (iOS C4, I10): Task 5, including the blocking state and the manager-visible count via the `self_repair` string the team card already reads.
- Login (spec 4.2 login; iOS I5, M4, M5; Android I9, I10): Task 6.
- Tap targets and the header collision (iOS I4, I5; Android I4, I5): Task 7.
- Type consistency: `frontDoorRedirect` and `NATIVE_COOKIE` (Task 1) are used by name in the middleware and the init; `pushDecision`, `Receive`, `hasReachedToday`, `REACHED_TODAY_EVENT`, `markReachedToday` (Task 2) match every call site; `barOf`, `statusBarPlan`, `StatusBarBand` (Task 3); `backAction` (Task 4); `locationBlocked`, `LocationBlockedStrip` (Task 5).
- Out of scope, PR 5 (native layer): the Android uploader, iOS back gesture, associated domains, channel importance, allowBackup, the picker theme, the navigation bar colour (needs a plugin).
