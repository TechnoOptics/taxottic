"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type Props = {
  // Pairs of { connectionId, lastSyncedAtIso (or null) } so we know
  // which connections are stale enough to warrant a background sync.
  connections: Array<{ id: string; lastSyncedAt: string | null }>;
  // How stale a connection needs to be before we kick a background
  // sync. Defaults to 15 minutes - long enough to dedupe page
  // refreshes, short enough that a user who left and came back sees
  // fresh data.
  staleAfterMs?: number;
};

/**
 * Fires a background sync of every stale Plaid connection on mount,
 * then refreshes the page so the user sees the new transactions /
 * forecast without having to click anything. Renders nothing.
 *
 * Hourly cron is the safety net; this component makes the experience
 * feel "live" when the user is actually looking at the page.
 *
 * Concurrency safety: a useRef gate prevents the same component
 * instance from firing twice (e.g. on a router.refresh() round-trip).
 * Cross-tab dedupe isn't worth chasing - the sync route is idempotent
 * and a duplicate hit is just a spare network call.
 */
export function PlaidAutoSync({ connections, staleAfterMs = 15 * 60 * 1000 }: Props) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    const stale = connections.filter((c) => {
      if (!c.lastSyncedAt) return true;
      return Date.now() - new Date(c.lastSyncedAt).getTime() > staleAfterMs;
    });
    if (!stale.length) return;
    fired.current = true;

    let aborted = false;
    (async () => {
      let anySucceeded = false;
      for (const c of stale) {
        try {
          const res = await fetch("/api/banks/plaid/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connectionId: c.id }),
          });
          if (res.ok) anySucceeded = true;
        } catch {
          /* swallow - cron retries */
        }
      }
      if (!aborted && anySucceeded) {
        router.refresh();
      }
    })();
    return () => {
      aborted = true;
    };
  }, [connections, staleAfterMs, router]);

  return null;
}
