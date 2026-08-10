"use client";

import { useEffect, useState } from "react";
import {
  describeGeofenceHealth,
  getGeofenceState,
  type GeofenceHealth,
} from "@/lib/mileage/geofence";

/**
 * "Is the tracker actually running?", the diagnostic strip the user
 * needs after the May 23 2026 drive-day where they reported "the
 * phone and the watch did not track my miles" and we found
 * point_count=0 across every trip in the DB.
 *
 * Renders right under the AutoTrackToggle, server-fed with the
 * latest mileage_point timestamp, and adds a CLIENT-rendered
 * relative time + plugin-availability check. Three states:
 *
 *   GREEN  Last point captured < 15 min ago → tracker is alive
 *   AMBER  Last point captured ≤ 24h ago    → tracker ran recently
 *   RED    No points OR ≥ 24h ago            → tracker probably broken;
 *                                              show the diagnostics
 *
 * Client-only piece is the relative time + the native-plugin
 * availability check (Capacitor + @capgo), the server can't see
 * either of those.
 */

type Props = {
  /** ISO timestamp of the most recent mileage_point this user has
   *  ever ingested. null = none ever. */
  lastPointISO: string | null;
  /** ISO timestamp of the most recent mileage_trip. */
  lastTripISO: string | null;
};

function relativeLabel(then: Date, now: Date): string {
  const diffMin = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return then.toLocaleDateString("en-US");
}

export function TrackerStatus({ lastPointISO, lastTripISO }: Props) {
  const [native, setNative] = useState<{
    isNative: boolean;
    bgAvailable: boolean | null;
  }>({ isNative: false, bgAvailable: null });

  // Learned-place geofence mesh health. This is the half of the story
  // the server cannot see: whether the mesh that is supposed to restart
  // tracking after an overnight process kill is actually armed, and
  // whether the last automatic restart could see location at all.
  //
  // It has to be shown. The bug this feature fixes hid for a week
  // because the tracking notification kept saying healthy while every
  // fix was being discarded, so a 21-hour blackout looked identical to
  // a quiet day. A status surface that can only say "fine" is how that
  // happens.
  const [geofence, setGeofence] = useState<GeofenceHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await getGeofenceState();
      if (cancelled) return;
      // Null means no native side to ask (web, or an older binary).
      // Say nothing rather than claim anything.
      if (state) setGeofence(describeGeofenceHealth(state));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        const isNative = Capacitor.isNativePlatform();
        // BackgroundGeolocation is the @capgo plugin id; we
        // explicitly check the SAME way native-tracker.ts does so
        // the diagnostic matches the actual runtime gate.
        const bgAvailable = isNative
          ? Capacitor.isPluginAvailable("BackgroundGeolocation")
          : null;
        setNative({ isNative, bgAvailable });
      } catch {
        setNative({ isNative: false, bgAvailable: null });
      }
    })();
  }, []);

  // Pick the more recent of point + trip, a trip with no point
  // (manual entry) still indicates "something happened recently."
  const lastActivityISO =
    lastPointISO && lastTripISO
      ? lastPointISO > lastTripISO
        ? lastPointISO
        : lastTripISO
      : lastPointISO ?? lastTripISO ?? null;

  const now = new Date();
  const then = lastActivityISO ? new Date(lastActivityISO) : null;
  const diffMin = then
    ? Math.round((now.getTime() - then.getTime()) / 60_000)
    : Infinity;

  const tone: "green" | "amber" | "red" =
    diffMin < 15 ? "green" : diffMin < 24 * 60 ? "amber" : "red";

  const dotClass =
    tone === "green"
      ? "bg-emerald-500"
      : tone === "amber"
        ? "bg-amber-500"
        : "bg-rose-500";

  const headline =
    tone === "green"
      ? "Tracker is alive"
      : tone === "amber"
        ? "Tracker ran recently"
        : then
          ? "Tracker hasn't logged in a while"
          : "Tracker has never captured a point";

  const subline = then
    ? `Last activity ${relativeLabel(then, now)}`
    : "No GPS points have been ingested on this account yet";

  return (
    <>
    <div
      className={
        "mt-3 rounded-2xl border px-4 py-3 " +
        (tone === "green"
          ? "border-emerald-100 bg-emerald-50/60"
          : tone === "amber"
            ? "border-amber-100 bg-amber-50/60"
            : "border-rose-100 bg-rose-50/60")
      }
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={"mt-1.5 size-2.5 rounded-full shrink-0 " + dotClass}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-forest-900">{headline}</div>
          <div className="text-xs text-ink-muted mt-0.5">{subline}</div>
          {tone === "red" ? (
            <details className="mt-2 group">
              <summary className="flex items-center gap-1 cursor-pointer select-none list-none text-[11px] font-medium text-forest-800">
                <span
                  aria-hidden="true"
                  className="inline-block transition-transform group-open:rotate-90"
                >
                  ›
                </span>
                Why isn&apos;t it tracking?
              </summary>
              <ul className="mt-2 text-[11px] text-ink-soft leading-relaxed grid gap-1">
              <li>
                <strong>Toggle:</strong> turn{" "}
                <span className="text-forest-900 font-medium">
                  Auto-track
                </span>{" "}
                ON above (the toggle persists in localStorage and
                re-arms on next launch).
              </li>
              <li>
                <strong>Permission:</strong> phone Settings → Apps →
                Taxottic → Location → set to{" "}
                <strong>Always</strong> (Background is required for
                drive capture).
              </li>
              <li>
                <strong>Schedule:</strong> check{" "}
                <a
                  href="/mileage/schedule"
                  className="underline underline-offset-2 text-forest-900"
                >
                  /mileage/schedule
                </a>{" "}
, the schedule decides when auto-resume is allowed.
              </li>
              {native.isNative === false ? (
                <li className="text-rose-700">
                  <strong>Where you are now:</strong> the web. Background
                  capture only runs in the installed Taxottic app -
                  open the app on your phone.
                </li>
              ) : native.bgAvailable === false ? (
                <li className="text-rose-700">
                  <strong>Plugin missing:</strong> the
                  BackgroundGeolocation plugin isn&apos;t present in
                  this binary. Reinstall the latest build.
                </li>
              ) : null}
              <li>
                <strong>Self-test:</strong>{" "}
                <a
                  href="/mileage/diagnose"
                  className="underline underline-offset-2 text-forest-900"
                >
                  Open /mileage/diagnose
                </a>{" "}
, one tap, runs the GPS plugin live, shows exactly
                which step fails on YOUR device. Screenshot and send.
              </li>
              <li>
                Or use <strong>“Log it manually”</strong> below to
                backfill the drive, same deduction either way.
              </li>
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </div>
    {geofence && geofence.status !== "unavailable" ? (
      <div
        className={
          "mt-2 rounded-2xl border px-4 py-3 " +
          (geofence.status === "ok"
            ? "border-emerald-100 bg-emerald-50/60"
            : geofence.status === "degraded"
              ? "border-amber-100 bg-amber-50/60"
              : "border-rose-100 bg-rose-50/60")
        }
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={
              "mt-1.5 size-2.5 rounded-full shrink-0 " +
              (geofence.status === "ok"
                ? "bg-emerald-500"
                : geofence.status === "degraded"
                  ? "bg-amber-500"
                  : "bg-rose-500")
            }
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-forest-900">
              Automatic restart
            </div>
            <div className="text-xs text-ink-muted mt-0.5">
              {geofence.message}
            </div>
            {geofence.action === "background_location" ? (
              <button
                type="button"
                onClick={() => {
                  void import("@/lib/mileage/device-status").then((m) =>
                    m.openLocationSettingsPrecise(),
                  );
                }}
                className="mt-2 text-[11px] font-medium underline underline-offset-2 text-forest-900"
              >
                Open location settings
              </button>
            ) : null}
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
