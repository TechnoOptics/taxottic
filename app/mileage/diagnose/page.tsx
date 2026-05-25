import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { DiagnoseClient } from "@/components/mileage/DiagnoseClient";
import Link from "next/link";

/**
 * Mileage tracker self-test page.
 *
 * User feedback: "I drove around the whole day today and nothing was
 * logged. This is now getting annoying." The TrackerStatus strip on
 * /mileage shows red when capture isn't happening, but doesn't
 * actually tell us WHY on the user's specific device. This page is
 * the one-tap diagnostic:
 *
 *   1. Tap "Start self-test" → DiagnoseClient walks every step of
 *      the @capgo plugin's start path, logging EACH state.
 *   2. The user can see (and screenshot) where it breaks:
 *      - native platform detected?
 *      - plugin registered in this binary?
 *      - dynamic import of @capgo resolved?
 *      - start() called? promise resolved or rejected?
 *      - callbacks firing? with location or with error?
 *      - first lat/lng received?
 *   3. Stop button tears it down cleanly.
 *
 * Server component shell; the diagnostic itself is a Client
 * Component (DiagnoseClient) because every step is a runtime call
 * the native shell has to be present for.
 */

export const dynamic = "force-dynamic";

export default async function MileageDiagnosePage() {
  const { user } = await requireUserWithAdmin();
  const memberships = await getMyCompanies();
  const companyId = memberships[0]?.company?.id ?? "";

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/mileage"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Mileage
          </Link>{" "}
          · Diagnose
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Tracker self-test
        </h1>
        <p className="mt-3 text-sm text-ink-soft max-w-2xl leading-relaxed">
          Tap <strong>Start self-test</strong> below to walk every step
          of the GPS plugin&apos;s start path on this device. Each
          state lights up as it succeeds (green) or fails (red).
          Screenshot the result and send it back so we can target the
          exact failure on YOUR phone instead of guessing.
        </p>

        <DiagnoseClient companyId={companyId} />

        <div className="mt-10 card p-5">
          <h2 className="display text-base text-forest-900">
            What each step means
          </h2>
          <ul className="mt-3 text-xs text-ink-soft leading-relaxed grid gap-2">
            <li>
              <strong>Native shell</strong>: Capacitor reports this is
              a real app (not the web). On the web this fails by
              design — open this page in the installed Taxottic app.
            </li>
            <li>
              <strong>Plugin available</strong>: the @capgo background-
              geolocation module is compiled into THIS build. If red,
              you&apos;re on an old TestFlight / APK that predates the
              plugin — rebuild.
            </li>
            <li>
              <strong>Import resolved</strong>: the JS shim loaded.
              We&apos;ve seen this hang on certain Samsung WebViews.
            </li>
            <li>
              <strong>start() returned</strong>: the native start
              promise settled. <em>resolved</em> = OK,{" "}
              <em>rejected</em> = OS-level failure (most often
              permission denied or service can&apos;t start).
            </li>
            <li>
              <strong>Callbacks firing</strong>: the GPS hardware is
              actually sending fixes. Counter ticks up as you move.
              If start() resolved but this stays at zero, the OS
              suppressed the GPS — almost always{" "}
              <strong>battery optimization</strong> killing the
              foreground service.
            </li>
            <li>
              <strong>First fix</strong>: actual lat/lng captured. If
              you see one here, the pipeline works and the production
              toggle should too. If you don&apos;t, dig into the prior
              step.
            </li>
          </ul>
        </div>

        <div className="mt-6 card p-5">
          <h2 className="display text-base text-forest-900">
            If the self-test passes but real drives still miss
          </h2>
          <p className="mt-3 text-xs text-ink-soft leading-relaxed">
            That&apos;s the Android battery-optimization story.
            Samsung in particular auto-puts apps to sleep aggressively.
            Whitelist Taxottic:
          </p>
          <ol className="mt-3 text-xs text-ink-soft leading-relaxed grid gap-1 list-decimal pl-5">
            <li>
              Phone Settings → <strong>Apps</strong> → Taxottic →
              <strong> Battery</strong>
            </li>
            <li>
              Set to <strong>Unrestricted</strong> (Samsung) /{" "}
              <strong>Unrestricted</strong> (Pixel) /{" "}
              <strong>Don&apos;t optimize</strong> (older Android)
            </li>
            <li>
              Same Apps page → <strong>Permissions → Location</strong>{" "}
              → <strong>Always</strong> (not just &quot;While
              using&quot;)
            </li>
            <li>
              Samsung only: Settings → Battery &amp; device care →
              Battery →
              <strong> Background usage limits</strong> → confirm
              Taxottic is NOT in &quot;Sleeping apps&quot;
            </li>
          </ol>
        </div>
      </section>
    </main>
  );
}
