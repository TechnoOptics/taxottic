"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getDeviceStatus,
  requestAlwaysUpgrade,
  requestBatteryExemption,
  requestMotionPermission,
  type DeviceStatus,
} from "@/lib/mileage/device-status";
import {
  getMileageTrackingUiState,
  openMileageLocationSettings,
} from "@/lib/mileage/native-tracker";

/**
 * "Make tracking reliable" wizard (reliability plan §C). The research
 * conclusion behind this page: the OS battery/permission machinery
 * cannot be beaten in code — every incumbent survives via GUIDED
 * WHITELISTING plus recurring re-checks (Samsung re-enables its
 * sleeping-apps setting after firmware updates). So this page is not
 * one-time onboarding: it re-verifies on every visit/focus, and the
 * health banner deep-links here whenever anything degrades.
 * Renders a graceful "checks run on the phone" note on web.
 */
export default function MileageSetupPage() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [tracking, setTracking] = useState(false);
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(() => {
    void getDeviceStatus().then((s) => {
      setStatus(s);
      setChecked(true);
    });
    try {
      setTracking(getMileageTrackingUiState().enabled);
    } catch {
      /* SSR/web */
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const isSamsung =
    (status?.manufacturer ?? "").toLowerCase().includes("samsung");
  const rows: {
    key: string;
    label: string;
    ok: boolean | null;
    detail: string;
    action?: { label: string; run: () => void };
  }[] = [
    {
      key: "tracking",
      label: "Auto-tracking is on",
      ok: tracking,
      detail: tracking
        ? "The tracker is armed."
        : "Flip the toggle on the Mileage page.",
    },
    {
      key: "auth",
      label: "Location set to Always",
      ok: status ? status.locationAuthorization === "always" : null,
      detail:
        status?.locationAuthorization === "always"
          ? "Drives record even with the app closed."
          : status?.platform === "ios"
            ? "iOS quietly reverts this — it must say Always, not While Using."
            : "Android needs “Allow all the time”.",
      action:
        status && status.locationAuthorization !== "always"
          ? status.platform === "ios"
            ? { label: "Request Always", run: () => void requestAlwaysUpgrade() }
            : {
                label: "Open settings",
                run: () => void openMileageLocationSettings(),
              }
          : undefined,
    },
    {
      key: "precise",
      label: "Precise location on",
      ok: status ? status.preciseLocation : null,
      detail: status?.preciseLocation
        ? "Full GPS accuracy."
        : "Approximate location cannot follow roads.",
      action:
        status && !status.preciseLocation
          ? {
              label: "Open settings",
              run: () => void openMileageLocationSettings(),
            }
          : undefined,
    },
    ...(status?.platform === "android"
      ? [
          {
            key: "battery",
            label: "Battery unrestricted",
            ok: status.batteryOptimized === false,
            detail:
              status.batteryOptimized === false
                ? "The OS won't starve background GPS."
                : "Battery optimization is the #1 cause of missing drives.",
            action:
              status.batteryOptimized !== false
                ? {
                    label: "Fix now",
                    run: () => void requestBatteryExemption(),
                  }
                : undefined,
          },
        ]
      : []),
    // Walk-away drive ending (both platforms): steps tell us the driver
    // left the car, closing the trip in ~30s instead of the 5-min timer.
    ...(status
      ? [
          {
            key: "motion",
            label: "Walk-away drive ending",
            ok: status.motionPermission === true,
            detail:
              status.motionPermission === true
                ? "Drives close the moment you walk away from the car."
                : "Allow motion & steps so drives close instantly when you park and walk away.",
            action:
              status.motionPermission !== true
                ? {
                    label: "Allow",
                    run: () => void requestMotionPermission().then(refresh),
                  }
                : undefined,
          },
        ]
      : []),
    ...(status?.platform === "ios"
      ? [
          {
            key: "lowpower",
            label: "Low Power Mode off",
            ok: status.lowPowerMode === true ? false : true,
            detail:
              status.lowPowerMode === true
                ? "iOS throttles background GPS under Low Power Mode."
                : "Background GPS runs at full fidelity.",
          },
        ]
      : []),
  ];

  const allOk = checked && status != null && rows.every((r) => r.ok === true);

  return (
    <main id="main" className="min-h-screen">
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Mileage · Reliability
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Make tracking bulletproof
        </h1>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-lg">
          Phones aggressively shut down background GPS. These checks are
          re-verified every time you visit — OS updates love to quietly
          undo them.
        </p>

        {!checked || status == null ? (
          <div className="card mt-6 p-6 text-sm text-ink-soft">
            {checked
              ? "These checks run on your phone — open this page in the Taxottic app to see live results."
              : "Checking your device…"}
          </div>
        ) : (
          <>
            <ul className="mt-6 grid gap-2">
              {rows.map((r) => (
                <li
                  key={r.key}
                  className="card p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={
                          "size-2.5 rounded-full shrink-0 " +
                          (r.ok === true ? "bg-emerald-500" : "bg-red-500")
                        }
                      />
                      <span className="text-sm font-medium text-forest-900">
                        {r.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                      {r.detail}
                    </p>
                  </div>
                  {r.action ? (
                    <button
                      type="button"
                      onClick={r.action.run}
                      className="btn-primary text-xs shrink-0"
                    >
                      {r.action.label}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            {isSamsung ? (
              <div className="card mt-4 p-4 border-amber-200 bg-amber-50/70">
                <div className="text-sm font-medium text-forest-900">
                  Samsung: two extra steps
                </div>
                <ol className="mt-2 text-xs text-ink-soft leading-relaxed list-decimal ml-4 grid gap-1">
                  <li>
                    Settings &rarr; Battery &rarr; Background usage limits:
                    remove Taxottic from Sleeping and Deep sleeping apps,
                    and turn OFF &ldquo;Put unused apps to sleep&rdquo;.
                  </li>
                  <li>
                    Re-check after every Samsung software update — it
                    re-enables these on its own.
                  </li>
                </ol>
              </div>
            ) : null}

            <div
              className={
                "card mt-6 p-5 " +
                (allOk ? "border-emerald-200 bg-emerald-50/60" : "")
              }
            >
              <div className="text-sm font-medium text-forest-900">
                {allOk
                  ? "Everything is green — tracking is bulletproof on this phone."
                  : "Fix the red items above, then come back here to confirm."}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Taxottic also watches from the server: if this phone ever
                goes quiet while tracking is on, you get a push within
                minutes.
              </p>
            </div>
          </>
        )}

        <div className="mt-6">
          <Link
            href="/mileage"
            className="text-sm text-forest-700 hover:text-forest-900"
          >
            &larr; Back to mileage
          </Link>
        </div>
      </section>
    </main>
  );
}
