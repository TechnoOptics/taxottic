"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mileage tracker self-test. Walks every step of the @capgo
 * background-geolocation plugin's start path and renders each state
 * as a green/red indicator so the user can screenshot the EXACT
 * failure mode on their device.
 *
 * Deliberately does NOT go through lib/mileage/native-tracker.ts —
 * we want the bare plugin behavior, not the production-toggle's
 * cached-plugin / warming dance. If this self-test works but the
 * toggle doesn't, the bug is in the toggle (we know what to fix).
 * If this self-test ALSO fails, the bug is OS/permission/plugin.
 */

type StepStatus = "idle" | "pending" | "ok" | "fail";

type Step = {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
};

type Props = {
  companyId: string;
};

export function DiagnoseClient({ companyId }: Props) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([
    { key: "native", label: "Native shell", status: "idle" },
    { key: "plugin", label: "Plugin available", status: "idle" },
    { key: "import", label: "Import resolved", status: "idle" },
    { key: "start", label: "start() returned", status: "idle" },
    { key: "callback", label: "Callbacks firing", status: "idle" },
    { key: "fix", label: "First fix", status: "idle" },
  ]);
  const [cbCount, setCbCount] = useState(0);
  const [lastFix, setLastFix] = useState<{
    lat: number;
    lng: number;
    accuracyM?: number;
    at: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [lastFixSec, setLastFixSec] = useState<number | null>(null);
  const pluginRef = useRef<{ stop: () => Promise<void> } | null>(null);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      void pluginRef.current?.stop?.().catch(() => {});
      pluginRef.current = null;
    };
  }, []);

  // Tick a 1-Hz timer while running so "elapsed" and "last fix Ns
  // ago" stay live without reading Date.now() during render (which
  // trips react-hooks/purity).
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startedAt) / 1000));
      setLastFixSec((prev) => (prev === null ? null : prev + 1));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  function setStep(key: string, status: StepStatus, detail?: string) {
    setSteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, status, detail } : s)),
    );
  }

  const start = async () => {
    setRunning(true);
    setError(null);
    setCbCount(0);
    setLastFix(null);
    setElapsedSec(0);
    setLastFixSec(null);
    setSteps((prev) =>
      prev.map((s) => ({ ...s, status: "idle", detail: undefined })),
    );

    // STEP 1: native shell
    setStep("native", "pending");
    let Capacitor: {
      isNativePlatform: () => boolean;
      isPluginAvailable: (n: string) => boolean;
      getPlatform: () => string;
    };
    try {
      ({ Capacitor } = await import("@capacitor/core"));
    } catch (e) {
      setStep("native", "fail", `import error: ${String(e)}`);
      setError("Capacitor core not available — are you on the web?");
      setRunning(false);
      return;
    }
    if (!Capacitor.isNativePlatform()) {
      setStep(
        "native",
        "fail",
        `platform=${Capacitor.getPlatform()} — open this in the installed Taxottic app, not a browser`,
      );
      setError("Open this page inside the installed Taxottic app on your phone.");
      setRunning(false);
      return;
    }
    setStep("native", "ok", Capacitor.getPlatform());

    // STEP 2: plugin available
    setStep("plugin", "pending");
    const present = Capacitor.isPluginAvailable("BackgroundGeolocation");
    if (!present) {
      setStep(
        "plugin",
        "fail",
        "BackgroundGeolocation not registered — rebuild + reinstall the app",
      );
      setError(
        "Your installed app predates the GPS plugin. Re-run the build pipeline and sideload / install the new APK or TestFlight.",
      );
      setRunning(false);
      return;
    }
    setStep("plugin", "ok");

    // STEP 3: import resolved
    setStep("import", "pending");
    let mod;
    try {
      mod = await import("@capgo/background-geolocation");
    } catch (e) {
      setStep("import", "fail", `import error: ${String(e).slice(0, 80)}`);
      setError("JS plugin shim failed to load. Hard-refresh and try again.");
      setRunning(false);
      return;
    }
    const bg = (mod as { BackgroundGeolocation?: unknown })
      .BackgroundGeolocation as
      | {
          start: (
            opts: Record<string, unknown>,
            cb: (location?: unknown, error?: unknown) => void,
          ) => Promise<void>;
          stop: () => Promise<void>;
        }
      | undefined;
    if (!bg || typeof bg.start !== "function") {
      setStep("import", "fail", "start fn missing on plugin shim");
      setError("Plugin shape mismatch. Rebuild the app.");
      setRunning(false);
      return;
    }
    setStep("import", "ok");
    pluginRef.current = bg;

    // STEP 4: start() returned
    setStep("start", "pending");
    setStep("callback", "pending");
    setStep("fix", "pending");

    // Fire-and-forget so we can watch callbacks even while the
    // start() promise is in-flight (some Android paths don't
    // resolve until the first fix arrives).
    bg.start(
      {
        backgroundMessage: "Tracker self-test in progress.",
        backgroundTitle: "Taxottic — diagnose",
        requestPermissions: true,
        stale: false,
        distanceFilter: 0, // capture every fix for the test
      },
      (location, err) => {
        setCbCount((n) => n + 1);
        setStep("callback", "ok");
        if (err) {
          const e = err as { code?: string; message?: string };
          setStep(
            "fix",
            "fail",
            `${e.code ?? "error"}: ${e.message ?? "unknown"}`,
          );
          setError(`Callback error: ${e.code ?? ""} ${e.message ?? ""}`);
          return;
        }
        if (location) {
          const loc = location as {
            latitude: number;
            longitude: number;
            accuracy?: number;
            time?: number;
          };
          setLastFix({
            lat: loc.latitude,
            lng: loc.longitude,
            accuracyM: loc.accuracy,
            at: Date.now(),
          });
          setLastFixSec(0); // reset "Ns ago" counter
          setStep(
            "fix",
            "ok",
            `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)} (±${Math.round(loc.accuracy ?? 0)}m)`,
          );
        }
      },
    )
      .then(() => setStep("start", "ok", "resolved"))
      .catch((e: { code?: string; message?: string }) => {
        setStep(
          "start",
          "fail",
          `${e.code ?? "rejected"}: ${e.message ?? "unknown"}`,
        );
        setError(`start() rejected: ${e.code ?? ""} ${e.message ?? ""}`);
      });
  };

  const stop = async () => {
    try {
      await pluginRef.current?.stop?.();
    } catch {
      /* ignore */
    }
    pluginRef.current = null;
    setRunning(false);
  };

  return (
    <div className="mt-6 grid gap-4">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
              Self-test
            </div>
            <div className="display text-lg text-forest-900 mt-1">
              Run the GPS plugin live on this device
            </div>
            <p className="text-xs text-ink-muted mt-1">
              {companyId
                ? "Tap Start, then walk or drive a short distance. Each step lights up as it happens."
                : "No company found — set one up first so the test has somewhere to point."}
            </p>
          </div>
          {running ? (
            <button
              type="button"
              onClick={stop}
              className="btn-ghost text-sm"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              className="btn-primary text-sm"
              disabled={!companyId}
            >
              Start self-test
            </button>
          )}
        </div>

        <ul className="mt-5 grid gap-2">
          {steps.map((s) => {
            const dot =
              s.status === "ok"
                ? "bg-emerald-500"
                : s.status === "fail"
                  ? "bg-rose-500"
                  : s.status === "pending"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-forest-200";
            return (
              <li key={s.key} className="flex items-start gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className={"mt-1 size-2.5 rounded-full shrink-0 " + dot}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-forest-900 font-medium">
                    {s.label}
                  </div>
                  {s.detail ? (
                    <div className="text-[11px] text-ink-muted mt-0.5 font-mono break-words">
                      {s.detail}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {running ? (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <Stat label="Callbacks" value={String(cbCount)} />
            <Stat
              label="Last fix"
              value={
                lastFixSec === null
                  ? "—"
                  : lastFixSec === 0
                    ? "just now"
                    : `${lastFixSec}s ago`
              }
            />
            <Stat label="Elapsed" value={`${elapsedSec}s`} />
            <Stat
              label="Accuracy"
              value={
                lastFix?.accuracyM != null
                  ? `±${Math.round(lastFix.accuracyM)}m`
                  : "—"
              }
            />
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-cream/60 border border-forest-100 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.18em] text-gold-700">
        {label}
      </div>
      <div className="text-forest-900 font-medium tabular-nums">{value}</div>
    </div>
  );
}
