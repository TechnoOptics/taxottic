"use client";

import { useEffect, useState } from "react";
import {
  startMileageTracking,
  stopMileageTracking,
  getMileageTrackingState,
} from "@/lib/mileage/native-tracker";

/**
 * The user-facing on/off for automatic drive logging. Renders on
 * every platform: on the native app it actually arms the background
 * watcher; on web it shows the same control disabled with a short
 * "use the app" note, so the feature is discoverable everywhere. The
 * privacy disclosure is always shown — Apple/Google review and basic
 * good faith both require the purpose to be stated at the toggle.
 */
export function AutoTrackToggle({ companyId }: { companyId: string }) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMileageTrackingState().then((s) => {
      if (cancelled) return;
      setSupported(s.supported);
      setEnabled(s.enabled);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        await stopMileageTracking();
        setEnabled(false);
      } else {
        const r = await startMileageTracking(companyId);
        if (r.ok) {
          setEnabled(true);
        } else {
          setError(
            r.error === "unavailable"
              ? "Automatic logging runs in the Taxottic mobile app."
              : "Couldn't start tracking. Check Location permission in Settings.",
          );
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-forest-900">
            Log my drives automatically
          </div>
          <p className="mt-1 text-xs text-ink-muted leading-relaxed">
            The app detects when you drive and stop, then logs the trip
            so you can mark it business or personal. Location is used
            only to compute your mileage deduction, sent straight to
            your Taxottic account, and never sold or shared. Turn this
            off any time; you can still add drives by hand.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Log my drives automatically"
          onClick={onToggle}
          disabled={busy || !ready || (!supported && !enabled)}
          className={
            "shrink-0 mt-0.5 inline-flex h-6 w-11 items-center rounded-full " +
            "transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
            (enabled ? "bg-forest-900" : "bg-forest-200")
          }
        >
          <span
            className={
              "inline-block h-5 w-5 transform rounded-full bg-cream " +
              "transition-transform " +
              (enabled ? "translate-x-5" : "translate-x-0.5")
            }
          />
        </button>
      </div>
      {!supported && ready ? (
        <p className="mt-2 text-[11px] text-ink-muted">
          Automatic logging runs in the Taxottic mobile app. On the web
          you can add drives manually below.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[11px] text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
