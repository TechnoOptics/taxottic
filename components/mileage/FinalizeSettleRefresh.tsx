"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Renders nothing. Closes the "the newest drive is not on the page" hole.
 *
 * /mileage materialises staged GPS points at render time under a 2.5s
 * budget. When that budget expires the page ships WITHOUT the drive that
 * was still being written, and until now the drive appeared only on some
 * later render, which is why the reported cure was "tap anything". That
 * tap was rendering the previous load's finalize result.
 *
 * The server tells us it was still outstanding; we wait for that ONE run
 * to complete and refresh ONCE.
 *
 * Deliberately not a poll. A loop here would have every phone parked on
 * this page hammering finalize, and the run we are waiting on is a single
 * known request whose completion we can simply await.
 *
 * Deliberately not a longer server budget either: that would trade a stale
 * list for a slow page on every load, including the overwhelming majority
 * where finalize finishes in well under the budget and this component is
 * never rendered at all.
 *
 * The finalize cron remains the backstop if the request never lands.
 */
export function FinalizeSettleRefresh() {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    // Fire-once gate. router.refresh() re-runs the server component, and
    // if that render is ALSO slow it mounts a fresh instance with its own
    // ref, which is correct: a genuinely new outstanding run deserves a
    // wait. What this stops is one instance firing twice.
    if (fired.current) return;
    fired.current = true;

    const ctrl = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/mileage/finalize", {
          method: "POST",
          signal: ctrl.signal,
        });
        if (cancelled || !res.ok) return;
        router.refresh();
      } catch {
        /* navigated away, offline, or the run failed. The cron covers it,
           and a failed refresh must never surface as an error to someone
           who only opened their drive log. */
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [router]);

  return null;
}
