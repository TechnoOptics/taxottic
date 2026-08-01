import Link from "next/link";

/**
 * UNREVIEWED DRAFT. Not legal advice, not a final legal instrument.
 *
 * This page was drafted from the code and database schema by an
 * engineering pass on 2026-08-01 and has NOT been reviewed by an
 * attorney. Everything here is a factual description of what the
 * software does, written so a lawyer can check it against the law.
 * Do not treat any statement on this page as a legal conclusion.
 *
 * Why this page exists, and what a reviewing attorney should focus on:
 *
 *   Taxottic is sold to companies. When a company turns on automatic
 *   mileage tracking for its staff, a manager (and any outside
 *   accounting firm with an active engagement) can see those staff
 *   members' driving records, including the GPS route line. That is
 *   employee location monitoring. Notice and consent requirements for
 *   it differ by jurisdiction, several US states impose specific
 *   obligations, and the UK/EU position under GDPR is materially
 *   stricter (necessity, proportionality, a lawful basis that is very
 *   unlikely to be employee consent, and a DPIA).
 *
 *   This page is written as a NOTICE, describing the mechanics
 *   accurately. It deliberately does NOT tell a customer that
 *   complying with it makes them lawful. Whether the product's
 *   design, and any particular customer's deployment of it, satisfies
 *   any given jurisdiction is a legal question for counsel.
 *
 * Facts on this page are sourced from:
 *   lib/mileage/team-scope.ts (the shared visibility rule)
 *   app/api/cron/mileage-retention/route.ts (retention windows)
 *   supabase/migrations/20260514000016_mileage_tracker.sql (RLS)
 *   supabase/migrations/20260731000001_mileage_learned_places.sql
 *   supabase/migrations/20260731000000_mileage_device_heartbeats.sql
 *   lib/maps/static-map.ts, lib/maps/reverseGeocode.ts (Google)
 * Re-verify these before changing any number below.
 */

export const metadata = {
  title: "Location tracking and team visibility - Taxottic",
  description:
    "What Taxottic records when automatic mileage tracking is on, how long it is kept, and exactly what a manager or an engaged accounting firm can see about an employee's drives.",
  alternates: { canonical: "/legal/location-monitoring" },
};

export default function LocationMonitoringPage() {
  return (
    <main id="main" className="min-h-screen">
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Location Tracking Notice
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Who can see your drives.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Effective: 2026-08-01 · Last updated: 2026-08-01
        </p>

        <p className="mt-6 text-sm text-ink-soft leading-relaxed">
          Automatic mileage tracking is the most sensitive thing Taxottic
          does. It runs in the background on your phone and it records
          where you drove. This page describes exactly what is recorded,
          how long it is kept, and who other than you can see it. It is
          part of our{" "}
          <Link
            href="/legal/privacy"
            className="underline hover:text-forest-900"
          >
            Privacy Policy
          </Link>
          .
        </p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <Section title="It is off until you turn it on">
            <p>
              Automatic tracking is off by default. It starts only after
              you open the Mileage screen, read the explanation there, tap
              Continue, and then grant your phone&apos;s location
              permission. You can turn it off from the same screen at any
              time, and you can deny or revoke the permission in your
              phone&apos;s settings. If tracking is off, you can still log
              drives by hand.
            </p>
            <p>
              While tracking is on, the app records location in the
              background, so a drive is captured even when the app is
              closed. On Android a persistent notification is shown for as
              long as the tracker is running.
            </p>
          </Section>

          <Section title="What is recorded">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <strong>GPS points while you move</strong>: latitude,
                longitude, speed, accuracy, and the time of each fix. A new
                point is taken roughly every 25 metres of travel (100
                metres in battery-saver mode).
              </li>
              <li>
                <strong>Trips</strong> assembled from those points: start
                and end time, distance, the route line, your
                business-or-personal classification, the deduction amount,
                and any note you add.
              </li>
              <li>
                <strong>Frequent places</strong>. The app clusters your
                recent driving history to infer where you regularly start
                and stop, and labels them home, work, or stop. This is used
                to restart tracking reliably and to make trip detection
                better. These inferred places are visible to you only.
              </li>
              <li>
                <strong>Device health</strong>: your platform, app version,
                whether tracking is enabled, the location permission you
                granted, whether precise location is on, whether battery
                optimisation or low-power mode is active, and how recently
                the app last uploaded. This carries no coordinates. It
                exists so we can tell you when tracking has silently
                stopped, which is the most common way people lose
                deductions.
              </li>
            </ul>
            <p>
              We do not record heading, altitude, your battery percentage,
              your device advertising identifier, or your phone number. We
              do not use physical-activity recognition.
            </p>
          </Section>

          <Section title="How long it is kept" id="retention">
            <p>
              These are the actual windows enforced by our nightly
              retention job, not aspirations:
            </p>
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <strong>Raw GPS fixes</strong> are deleted 30 days after
                they have been built into a trip. A fix that never got
                built into a trip is closed out after 45 days and deleted
                30 days after that, so no raw fix survives past roughly 75
                days.
              </li>
              <li>
                <strong>Device-health history</strong> is deleted after 30
                days. The single most-recent device-health record per
                driver is kept while the account exists, because the
                trip-building job reads it.
              </li>
              <li>
                <strong>Trips and their route lines are kept until they
                are deleted.</strong> There is no automatic expiry on them.
                They are removed when you delete the trip, when the company
                is deleted, or when the account is deleted. We keep them
                because a mileage deduction has to be substantiated to the
                IRS years after the drive.
              </li>
              <li>
                <strong>Inferred frequent places</strong> are recomputed
                from your last 90 days of driving and are removed with the
                account.
              </li>
            </ul>
            <p>
              You can delete any trip yourself from the Mileage screen.
              Deleting a trip deletes its route line with it.
            </p>
          </Section>

          <Section title="What a manager can see" id="employer-visibility">
            <p>
              If you drive for a company on Taxottic, people other than you
              can see some of your drives. This is the part worth reading
              carefully.
            </p>
            <p>
              <strong>
                A manager or owner at your company can see a drive once it
                is classified as business and confirmed.
              </strong>{" "}
              For those drives they see:
            </p>
            <ul className="list-disc pl-5 grid gap-2">
              <li>the route line on a map, drawn from your GPS points,</li>
              <li>the start and end time of the drive,</li>
              <li>the distance and the deduction amount,</li>
              <li>any note you attached,</li>
              <li>your name, and your department if one is set,</li>
              <li>
                when they open a single driver&apos;s view, a street-level
                label for where the drive started and ended, which can
                include the name of a business at that address,
              </li>
              <li>
                your device-health status, meaning whether tracking is on
                and when your phone last uploaded. Managers use this to
                spot a phone that has stopped tracking.
              </li>
            </ul>
            <p>
              A manager viewing the whole team sees this for every driver
              on the team by default.
            </p>
            <p>
              <strong>
                Drives you classified as personal, drives you have not
                classified yet, and drives still waiting for your
                confirmation are not shown to your manager.
              </strong>{" "}
              Their route lines are never sent to a manager&apos;s screen.
              The only way a drive becomes visible to your company is if it
              is marked business and confirmed.
            </p>
            <p>
              If your company has engaged an outside accounting firm
              through Taxottic, that firm sees the same category of drives,
              business and confirmed only, across the clients it is engaged
              with, together with the company&apos;s saved places.
            </p>
            <p>
              Taxottic staff can technically reach this data to operate and
              support the service. Any such access is recorded against the
              named employee and is visible to the account owner in the
              audit log.
            </p>
          </Section>

          <Section title="If you are the employer">
            <p>
              When your company enables mileage tracking for staff, your
              company decides who is tracked and why. Employee location
              monitoring is regulated, and the rules are not the same
              everywhere. Several US states require specific written notice
              or consent before an employer tracks an employee, some
              restrict tracking outside working hours or on an
              employee&apos;s own vehicle, and the UK and EU treat it as
              high-risk processing that generally requires a documented
              necessity and proportionality assessment and a lawful basis
              that is usually not employee consent.
            </p>
            <p>
              We give you the product controls, this notice, and a{" "}
              <Link
                href="/legal/dpa"
                className="underline hover:text-forest-900"
              >
                Data Processing Agreement
              </Link>
              . We cannot tell you whether your particular deployment is
              lawful where your people work.{" "}
              <strong>
                Nothing on this page is legal advice. Take advice from your
                own counsel before you roll mileage tracking out to
                employees.
              </strong>
            </p>
            <p>
              What we can tell you about the design: tracking is opt-in on
              the driver&apos;s own device, the driver classifies each
              drive, and only drives the driver marks as business become
              visible to the company.
            </p>
          </Section>

          <Section title="Where location data goes">
            <p>
              Location data is not sold, and it is not used for
              advertising, profiling, or any purpose other than your
              mileage deduction and making the tracker work.
            </p>
            <p>
              It is stored in our database with our hosting providers, and
              coordinates are sent to Google Maps Platform so that maps,
              route thumbnails, and place names can be drawn. That means
              Google receives the coordinates involved in rendering a map
              or naming a location. The full list of vendors is at{" "}
              <Link
                href="/legal/subprocessors"
                className="underline hover:text-forest-900"
              >
                /legal/subprocessors
              </Link>
              .
            </p>
          </Section>

          <Section title="Your choices">
            <ul className="list-disc pl-5 grid gap-2">
              <li>Turn tracking off from the Mileage screen at any time.</li>
              <li>
                Revoke the location permission in your phone&apos;s
                settings.
              </li>
              <li>Delete individual trips, which deletes their routes.</li>
              <li>
                Export everything we hold on you from{" "}
                <Link
                  href="/settings/data"
                  className="underline hover:text-forest-900"
                >
                  /settings/data
                </Link>
                .
              </li>
              <li>
                Ask us to delete your data by writing to{" "}
                <a
                  href="mailto:privacy@taxottic.com"
                  className="underline hover:text-forest-900"
                >
                  privacy@taxottic.com
                </a>
                . If your drives were recorded for an employer, that
                employer may hold its own copy of the business mileage
                records it needs for tax substantiation, and we will tell
                you if that is the case.
              </li>
            </ul>
          </Section>
        </div>
      </section>
    </main>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={id ? "scroll-mt-24" : undefined}>
      <h2 className="display text-xl text-forest-900">{title}</h2>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}
