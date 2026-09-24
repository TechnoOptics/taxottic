import { NextResponse } from "next/server";

/**
 * Apple App Site Association (AASA).
 *
 * iOS fetches https://taxottic.com/.well-known/apple-app-site-association
 * once, unauthenticated, when the app is installed, and uses it to decide
 * whether a taxottic.com link opens the app or Safari. The iOS side of the
 * handshake is the `com.apple.developer.associated-domains` entitlement in
 * ios/App/App/App.entitlements (`applinks:taxottic.com`); both halves have
 * to agree or nothing opens.
 *
 * Why a route and not a file in public/.well-known/ next to
 * microsoft-identity-association.json, which is the existing precedent
 * here: two reasons, either of which alone forces a route.
 *   1. The file has NO extension, and Apple requires
 *      `application/json`. A static file served from public/ is typed
 *      from its extension, so an extensionless one goes out as
 *      application/octet-stream and Apple rejects it.
 *   2. The Apple team id is not in this repository and must not be. The
 *      Xcode project carries no DEVELOPMENT_TEAM; the release workflow
 *      injects it from the IOS_TEAM_ID GitHub secret
 *      (.github/workflows/ios-release.yml). A static file would mean
 *      committing it, or committing a placeholder.
 *
 * The owner must set APPLE_TEAM_ID in Vercel to the same value as the
 * IOS_TEAM_ID secret. Until then this returns 500, deliberately.
 */

// The team id is read per request, not frozen into a build. Without this
// Next can evaluate the handler at build time and bake whatever
// APPLE_TEAM_ID was (or was not) set in the build environment into a
// static response.
export const dynamic = "force-dynamic";

// Limited on purpose. Every path listed here is torn out of Safari and
// handed to the app for anyone who has it installed, so a wildcard would
// capture marketing, legal, guides and calculator links that must stay
// shareable on the web.
//
// /auth/* is the load-bearing one and the reason this file exists. The
// sign-in email's link resolves to /auth/callback (app/login/page.tsx
// sets emailRedirectTo and redirectTo to `${origin}/auth/callback`), so
// without it the email still opens Safari, the driver signs in there,
// and the app they installed stays signed out. That was the audit's
// actual finding, and a list that omitted it would have looked correct
// and fixed nothing.
//
// /app/* is deliberately absent: no such route exists in this codebase.
// The signed-in surfaces are /dashboard, /mileage, /personal and their
// siblings, and they are reached from /auth/callback rather than linked
// to directly from email, so they do not need their own entry yet.
const PATHS = ["/auth/*", "/login*", "/get*"];

// Not "the iOS bundle id" loosely: com.taxottic.app.TaxotticWidget is a
// separate bundle id in this project and is NOT the app.
const BUNDLE_ID = "com.taxottic.app";

export function GET() {
  const team = process.env.APPLE_TEAM_ID;
  if (!team) {
    // A wrong or placeholder team id is worse than no file at all:
    // Apple caches this aggressively, so a bad one poisons deep links
    // for as long as the cache holds. A 500 fails closed and visibly.
    return new NextResponse("APPLE_TEAM_ID is not set", { status: 500 });
  }

  return NextResponse.json({
    applinks: {
      details: [
        {
          appIDs: [`${team}.${BUNDLE_ID}`],
          paths: PATHS,
        },
      ],
    },
  });
}
