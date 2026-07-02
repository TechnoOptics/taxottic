"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Props = {
  count: number;
  firstHref: string;
};

// Separate dismissal key from the popup's — a user can close the popup
// and still see this slim reminder (or vice versa); each surface has
// its own per-session memory so dismissing one doesn't silently hide
// the other.
const DISMISS_KEY = "taxottic.outstanding.banner.dismissed";

/**
 * Slim, persistent-but-quiet reminder rendered globally under the app
 * header when items are outstanding. Dismissible for the session (the
 * bell keeps the live count regardless); reappears on the next fresh
 * session, same as the popup.
 */
export function OutstandingTasksBanner({ count, firstHref }: Props) {
  const [dismissed, setDismissed] = useState(true);
  const [mountedClient, setMountedClient] = useState(false);
  const [effectError, setEffectError] = useState<string | null>(null);

  useEffect(() => {
    try {
      let wasDismissed = false;
      try {
        wasDismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
      } catch {
        /* private mode — treat as not dismissed */
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only sessionStorage; must run after mount
      setDismissed(wasDismissed);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- proves this effect ran at all
      setMountedClient(true);
    } catch (e) {
      setEffectError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <>
      <div style={{ background: "lime", padding: 4, fontSize: 11 }}>
        TEMP-DEBUG banner: mountedClient={String(mountedClient)} dismissed=
        {String(dismissed)} count={count} err={effectError ?? "none"}
        <button
          type="button"
          style={{ marginLeft: 8, background: "black", color: "white", padding: "2px 8px" }}
          onClick={() => setMountedClient(true)}
        >
          CLICK-TEST
        </button>
      </div>
      {count <= 0 || dismissed ? null : (
    <div className="flex items-center gap-3 rounded-xl border border-gold-300/60 bg-gold-50/70 px-4 py-2.5 text-xs text-forest-900">
      <span aria-hidden="true">🔔</span>
      <span className="min-w-0 flex-1">
        {count} item{count === 1 ? "" : "s"} need{count === 1 ? "s" : ""} a
        business-or-personal call before they count toward your deduction.
      </span>
      <Link
        href={firstHref}
        className="shrink-0 font-medium text-forest-700 hover:text-forest-900 underline underline-offset-2"
      >
        Review now
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* private mode — reappears next reload, acceptable */
          }
        }}
        className="shrink-0 text-ink-muted hover:text-forest-900"
      >
        ×
      </button>
    </div>
      )}
    </>
  );
}
