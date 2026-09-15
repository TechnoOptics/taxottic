import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { frontDoorRedirect, NATIVE_COOKIE } from "./front-door";

describe("native front door", () => {
  it("sends a signed-out native launch of / to /login", () => {
    expect(frontDoorRedirect({ pathname: "/", hasUser: false, nativeCookie: true, otherHost: false })).toBe("/login");
  });
  it("leaves the web, signed-in users and every other path alone", () => {
    expect(frontDoorRedirect({ pathname: "/", hasUser: false, nativeCookie: false, otherHost: false })).toBeNull();
    expect(frontDoorRedirect({ pathname: "/", hasUser: true, nativeCookie: true, otherHost: false })).toBeNull();
    expect(frontDoorRedirect({ pathname: "/pricing", hasUser: false, nativeCookie: true, otherHost: false })).toBeNull();
  });
  it("does not redirect on admin or firm hosts even with the cookie", () => {
    expect(frontDoorRedirect({ pathname: "/", hasUser: false, nativeCookie: true, otherHost: true })).toBeNull();
  });
  it("is wired: the middleware reads the cookie, gates on host, and the init sets it", () => {
    const mw = readFileSync("lib/supabase/middleware.ts", "utf8");
    expect(mw).toMatch(/frontDoorRedirect\(\{/);
    expect(mw).toMatch(/request\.cookies\.get\(NATIVE_COOKIE\)/);
    expect(mw).toMatch(/otherHost: isAdminHost \|\| isFirmHost/);
    const init = readFileSync("components/CapacitorNativeInit.tsx", "utf8");
    expect(init).toMatch(new RegExp(`document\\.cookie = \`\\$\\{NATIVE_COOKIE\\}=1`));
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).toMatch(/<NativeFrontDoor \/>/);
    expect(NATIVE_COOKIE).toBe("taxottic_native");
  });
});
