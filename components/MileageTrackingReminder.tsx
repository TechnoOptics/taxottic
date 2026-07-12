"use client";

import { useEffect, useState } from "react";
import {
  getMileageTrackingUiState,
  openMileageLocationSettings,
  retryMileageTracking,
} from "@/lib/mileage/native-tracker";

// Once the user acknowledges the soft reminder we stop nagging, UNLESS a
// real permission failure is later detected (that state is never
// dismissible, it means drives are actively not being recorded).
const DISMISS_KEY = "taxottic.mileage.alwaysReminderDismissed";

/**
 * Native-only banner that keeps mileage tracking honest about the one
 * setting people get wrong: Location must be "Always", not "While Using".
 * On iOS especially, "While Using" silently stops recording the moment
 * the app is backgrounded, so a whole day of drives can vanish with no
 * error (exactly what happened to a real user, July 5-6 2026).
 *
 * Two states:
 *   - BLOCKED (forced, not dismissible): the tracker reported a
 *     permission failure, so drives are NOT being recorded right now.
 *   - REMINDER (soft, dismissible): tracking is on and working, but we
 *     proactively remind the user to keep Location on "Always" so it
 *     stays that way.
 *
 * Renders nothing on web and nothing in the normal, correctly-configured
 * case once the reminder is acknowledged.
 */
export function MileageTrackingReminder() {
  const [mounted, setMounted] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [state, setState] = useState({ enabled: false, permBlocked: false });
  const [authBlocked, setAuthBlocked] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount + client-only reads
    setMounted(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setIsNative((window as any).Capacitor?.isNativePlatform?.() === true);
    } catch {
      /* not in a Capacitor context */
    }
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* private mode */
    }

    const refresh = () => {
      setState(getMileageTrackingUiState());
      try {
        setAuthBlocked(
          localStorage.getItem("taxottic.mileage.authBlocked") === "1",
        );
      } catch {
        /* private mode */
      }
    };
    refresh();
    // Session-dead signal from the tracker's flush loop (401 after a
    // refresh attempt): drives its own banner below.
    window.addEventListener("taxottic:mileage-auth", refresh);
    // Live updates: the tracker dispatches this on every permission
    // change; also re-check on focus / app resume.
    window.addEventListener("taxottic:mileage-perm", refresh);
    window.addEventListener("focus", refresh);
    let removeAppListener = () => {};
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("resume", refresh);
        removeAppListener = () => void handle.remove();
      } catch {
        /* @capacitor/app absent in this binary */
      }
    })();

    return () => {
      window.removeEventListener("taxottic:mileage-perm", refresh);
      window.removeEventListener("taxottic:mileage-auth", refresh);
      window.removeEventListener("focus", refresh);
      removeAppListener();
    };
  }, []);

  if (!mounted || !isNative) return null;

  const blocked = state.permBlocked;
  const reminder = !blocked && !authBlocked && state.enabled && !dismissed;
  if (!blocked && !reminder && !authBlocked) return null;

  if (authBlocked) {
    // Session expired while the tracker was buffering: the drives are
    // SAFE on this device, but nothing uploads until they sign in
    // again. Non-dismissible — silence here is how a day went missing.
    return (
      <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <div className="text-sm font-semibold text-red-900">
          Sign in again to keep mileage syncing
        </div>
        <p className="mt-1 text-xs leading-relaxed text-red-800">
          Your drives are still being recorded and are saved on this
          phone, but they can&apos;t upload until you sign back in.
        </p>
        <a
          href="/login?next=/mileage"
          className="mt-2 inline-flex items-center rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white"
        >
          Sign in
        </a>
      </div>
    );
  }

  async function openSettings() {
    setBusy(true);
    try {
      await openMileageLocationSettings();
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      await retryMileageTracking();
      setState(getMileageTrackingUiState());
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode */
    }
    setDismissed(true);
  }

  return (
    <div
      className="fixed left-1/2 z-[60] w-full max-w-md -translate-x-1/2 px-4"
      style={{
        bottom:
          "calc(max(var(--safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 5rem)",
      }}
    >
      <div
        className={
          "card card-opaque flex flex-col gap-2 px-4 py-3 shadow-2xl border " +
          (blocked ? "border-red-300" : "border-gold-300/60")
        }
      >
        <div className="text-sm font-medium text-forest-900">
          {blocked
            ? "Mileage tracking is paused"
            : "Keep location set to Always"}
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">
          {blocked
            ? "Your drives are not being recorded. Taxottic needs Location set to “Always” to track mileage in the background."
            : "So drives record even when the app is closed, Taxottic’s Location permission must stay on “Always” (not “While Using”)."}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={openSettings}
            disabled={busy}
            className="btn-primary h-9 px-3 text-xs disabled:opacity-50"
          >
            {busy ? "…" : "Open location settings"}
          </button>
          {blocked ? (
            <button
              type="button"
              onClick={retry}
              disabled={busy}
              className="h-9 px-3 text-xs font-medium text-forest-800 hover:text-forest-900 disabled:opacity-50"
            >
              I&apos;ve enabled it
            </button>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              className="h-9 px-3 text-xs font-medium text-ink-muted hover:text-forest-800"
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
