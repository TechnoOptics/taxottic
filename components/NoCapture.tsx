"use client";

import { useEffect } from "react";

type Props = {
  /** When true, leave Ctrl+P (print) alone. Set on routes meant to
   *  be printable, e.g., the year-end CPA export. Default false. */
  allowPrint?: boolean;
  /** When true, allow text selection. Default false (denies copy/paste
   *  of rendered text). */
  allowSelect?: boolean;
};

const ENDPOINT = "/api/capture-attempt";

/**
 * Client-only deterrent stack. None of this prevents OS-level screen
 * capture; it raises the friction for casual offenders, makes the
 * right-click "save image as" path one-click harder, and pings a
 * server-side audit log on every detected attempt so a leak has a
 * paper trail.
 *
 * Things this does:
 *   - Disables the right-click context menu site-wide
 *   - Blocks Ctrl+S, Cmd+S, Ctrl+P, Cmd+P (unless allowPrint)
 *   - Blocks Ctrl+Shift+I/J (devtools), Cmd+Opt+I/J/U
 *   - Blocks Ctrl+U (view source)
 *   - On PrintScreen keyup, overwrites the clipboard with a notice
 *   - Adds <body class="no-capture"> so CSS denies user-select,
 *     image dragging, and print rendering when allowPrint is false
 *   - Polls innerHeight / outerHeight delta to detect devtools open;
 *     when tripped, logs once and dispatches a 'tx-capture' event
 *
 * Things this does NOT do:
 *   - Stop someone with a phone camera, an OBS recording, or a second
 *     monitor mirroring app
 *   - Stop a developer who knows the bypass dance
 */
export function NoCapture({ allowPrint = false, allowSelect = false }: Props) {
  useEffect(() => {
    const body = document.body;
    body.classList.add("no-capture");
    if (!allowPrint) body.classList.add("no-capture-print");
    if (!allowSelect) body.classList.add("no-capture-select");

    let devtoolsTrippedOnce = false;

    function logAttempt(kind: string, details?: Record<string, unknown>) {
      // sendBeacon is fire-and-forget and survives page unloads; it
      // doesn't return a promise, doesn't block the UI, and the
      // server-side route writes to capture_attempts.
      try {
        const payload = JSON.stringify({
          kind,
          path: window.location.pathname,
          details: details ?? null,
        });
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(ENDPOINT, blob);
      } catch {
        // sendBeacon can throw under some privacy-mode configs; swallow.
      }
    }

    function onContextMenu(e: MouseEvent) {
      // Allow context menu inside text inputs / textareas so users can
      // still paste, undo, etc. Block everywhere else.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      logAttempt("right_click");
    }

    function onKeyDown(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (meta && k === "s") {
        e.preventDefault();
        logAttempt("save_shortcut");
      }
      if (!allowPrint && meta && k === "p") {
        e.preventDefault();
        logAttempt("print_shortcut");
      }
      if (meta && e.shiftKey && (k === "i" || k === "j" || k === "c")) {
        // Block devtools opening shortcut on best-effort basis.
        // The browser will still open if the user uses the menu.
        e.preventDefault();
      }
      if (meta && k === "u") {
        // View source
        e.preventDefault();
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      // PrintScreen captures the screen to the OS clipboard. We can't
      // intercept the capture itself, but we can overwrite the clipboard
      // immediately after with a notice so a paste doesn't yield the
      // screenshot. Bypassable, but a real friction point.
      if (e.key === "PrintScreen") {
        try {
          navigator.clipboard?.writeText(
            "[Taxottic blocked screen capture - protected content]",
          );
        } catch {
          // permissions may deny clipboard write; fine.
        }
        logAttempt("print_screen");
      }
    }

    function onDragStart(e: DragEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "IMG") {
        e.preventDefault();
        logAttempt("image_drag");
      }
    }

    function onBeforePrint() {
      if (allowPrint) return;
      logAttempt("unauthorized_print");
    }

    // Devtools heuristic. Open devtools changes the relationship
    // between window.outerWidth and window.innerWidth (or innerHeight).
    // We log once per session to avoid spamming the audit table.
    function checkDevtools() {
      if (devtoolsTrippedOnce) return;
      const wDiff = window.outerWidth - window.innerWidth;
      const hDiff = window.outerHeight - window.innerHeight;
      // 160px threshold - chrome devtools docked typically takes 200+.
      // The user's chrome may be small (e.g., 7px on Mac); we want to
      // catch the docked devtools pane specifically.
      if (wDiff > 160 || hDiff > 200) {
        devtoolsTrippedOnce = true;
        logAttempt("devtools_open", {
          wDiff,
          hDiff,
        });
        // Also dispatch an event consumers can listen for if they want
        // to e.g., blur the page.
        window.dispatchEvent(new CustomEvent("tx-capture", { detail: "devtools" }));
      }
    }
    const devtoolsTimer = window.setInterval(checkDevtools, 1500);

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("dragstart", onDragStart);
    window.addEventListener("beforeprint", onBeforePrint);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.clearInterval(devtoolsTimer);
      body.classList.remove("no-capture", "no-capture-print", "no-capture-select");
    };
  }, [allowPrint, allowSelect]);

  return null;
}
