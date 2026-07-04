"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * On-device diagnostics for the iOS/Android shells, built because an
 * iPhone can't be remote-inspected from a Windows dev box (no ADB
 * equivalent; Safari Web Inspector is macOS-only; release WKWebViews
 * aren't inspectable since iOS 16.4). This page turns the phone itself
 * into the probe: it reads every input the safe-area system uses (env()
 * insets, the --app-safe-top / --safe-bottom overrides set by
 * CapacitorNativeInit, the native SafeArea plugin's real insets, the
 * actual rendered header padding and hamburger-FAB position, app build
 * number, SW cache version) and shows them in one copyable blob the
 * user can paste into a support/debug conversation.
 *
 * Reach it from Settings → Device diagnostics.
 */

type Readings = Record<string, string>;

async function collect(): Promise<Readings> {
  const r: Readings = {};

  r["url"] = window.location.pathname;
  r["viewport"] = `${window.innerWidth}x${window.innerHeight}`;
  r["screen"] = `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}x`;
  r["userAgent"] = navigator.userAgent;

  // env(safe-area-inset-*) as the WebView actually resolves them.
  const envProbe = document.createElement("div");
  envProbe.style.cssText =
    "position:fixed;left:-9999px;top:0;" +
    "padding-top:env(safe-area-inset-top,0px);" +
    "padding-bottom:env(safe-area-inset-bottom,0px);" +
    "padding-left:env(safe-area-inset-left,0px);" +
    "padding-right:env(safe-area-inset-right,0px);";
  document.body.appendChild(envProbe);
  const ec = getComputedStyle(envProbe);
  r["env.safeAreaInset"] =
    `top=${ec.paddingTop} bottom=${ec.paddingBottom} left=${ec.paddingLeft} right=${ec.paddingRight}`;
  envProbe.remove();

  // The JS-set overrides (CapacitorNativeInit), raw expression form.
  const rootStyle = document.documentElement.style;
  r["var.appSafeTop"] =
    rootStyle.getPropertyValue("--app-safe-top").trim() || "(unset)";
  r["var.safeBottom"] =
    rootStyle.getPropertyValue("--safe-bottom").trim() || "(unset)";

  // What the header/FAB formulas RESOLVE to on this device.
  const resProbe = document.createElement("div");
  resProbe.style.cssText =
    "position:fixed;left:-9999px;top:0;" +
    "padding-top:max(var(--app-safe-top,0px),env(safe-area-inset-top,0px));" +
    "padding-bottom:max(var(--safe-bottom,0px),env(safe-area-inset-bottom,0px));";
  document.body.appendChild(resProbe);
  const rc = getComputedStyle(resProbe);
  r["resolved.headerSafeTop"] = rc.paddingTop;
  r["resolved.fabSafeBottom"] = rc.paddingBottom;
  resProbe.remove();

  // Ground truth: the real rendered chrome on this page.
  const header = document.querySelector("header.app-header");
  if (header) {
    const hs = getComputedStyle(header);
    const hr = header.getBoundingClientRect();
    r["header.actualPaddingTop"] = hs.paddingTop;
    r["header.rect"] = `top=${Math.round(hr.top)}px height=${Math.round(hr.height)}px`;
  } else {
    r["header.actualPaddingTop"] = "(header not on this page)";
  }
  const fab = document.querySelector('button[aria-label="Open menu"]');
  if (fab) {
    const fr = fab.getBoundingClientRect();
    r["fab.gapFromBottom"] = `${Math.round(window.innerHeight - fr.bottom)}px`;
    r["fab.gapFromLeft"] = `${Math.round(fr.left)}px`;
  } else {
    r["fab.gapFromBottom"] = "(no FAB, wide viewport?)";
  }

  // Service-worker cache generation (which web bundle is live).
  try {
    const keys = await caches.keys();
    r["sw.caches"] = keys.join(", ") || "(none)";
  } catch {
    r["sw.caches"] = "(cache API unavailable)";
  }

  // Native layer.
  try {
    const { Capacitor } = await import("@capacitor/core");
    const native = Capacitor.isNativePlatform();
    r["platform"] = native ? Capacitor.getPlatform() : "web";
    if (native) {
      try {
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        r["app.version"] = info.version;
        r["app.build"] = info.build;
      } catch {
        r["app.build"] = "(App plugin unavailable)";
      }
      const hasSafeArea = Capacitor.isPluginAvailable("SafeArea");
      r["plugin.SafeArea"] = hasSafeArea ? "available" : "ABSENT (old binary)";
      if (hasSafeArea) {
        try {
          const { SafeArea } = await import("capacitor-plugin-safe-area");
          const { insets } = await SafeArea.getSafeAreaInsets();
          r["native.insets"] =
            `top=${insets.top} bottom=${insets.bottom} left=${insets.left} right=${insets.right}`;
        } catch (e) {
          r["native.insets"] = `error: ${String(e).slice(0, 80)}`;
        }
      }
      if (Capacitor.isPluginAvailable("StatusBar")) {
        try {
          const { StatusBar } = await import("@capacitor/status-bar");
          const sb = await StatusBar.getInfo();
          r["statusBar.info"] = JSON.stringify(sb);
        } catch {
          r["statusBar.info"] = "(getInfo failed)";
        }
      }
    }
  } catch {
    r["platform"] = "web (capacitor not bundled)";
  }

  return r;
}

export function DeviceDiagnostics() {
  const [readings, setReadings] = useState<Readings | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    // Two passes: immediately, and again after CapacitorNativeInit's
    // async plugin calls have had time to set the CSS overrides, so a
    // cold open of this page still shows the settled values. setState
    // only happens inside the async continuations (never synchronously
    // in the effect body, react-hooks/set-state-in-effect).
    void collect().then((data) => {
      setReadings(data);
      setCopied(false);
    });
    const t = setTimeout(() => void collect().then(setReadings), 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const cancel = refresh();
    return cancel;
  }, [refresh]);

  const blob = readings
    ? Object.entries(readings)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(blob);
      setCopied(true);
    } catch {
      /* clipboard blocked, the textarea below is selectable */
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="btn-primary text-sm px-4 h-10"
          disabled={!readings}
        >
          {copied ? "Copied ✓" : "Copy all readings"}
        </button>
        <button
          type="button"
          onClick={refresh}
          className="btn-ghost text-sm px-4 h-10"
        >
          Re-read
        </button>
      </div>

      {readings ? (
        <ul className="grid gap-1.5">
          {Object.entries(readings).map(([k, v]) => (
            <li
              key={k}
              className="rounded-lg border border-forest-100 bg-white/70 px-3 py-2"
            >
              <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
                {k}
              </div>
              <div className="text-sm text-forest-900 break-all">{v}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-ink-muted">Reading device state…</div>
      )}

      {/* Fallback for WebViews where the async clipboard API is
          restricted: a plain selectable textarea of the same blob. */}
      <textarea
        readOnly
        value={blob}
        rows={6}
        className="input !h-auto font-mono text-[11px] leading-relaxed"
        aria-label="Diagnostics text"
      />
    </div>
  );
}
