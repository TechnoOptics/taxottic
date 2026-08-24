"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  runReturnRefresh,
  shouldRefreshOnReturn,
} from "@/lib/mileage/return-refresh";
import { beatOnForeground } from "@/lib/mileage/heartbeat-timer";

/**
 * Renders nothing. Re-renders the drive log when the driver comes back to it.
 *
 * Two drivers reported the same thing: open Mileage and the drives are
 * not there, then "click around and different things so hopefully the
 * drives can refresh and load". Clicking around is a navigation, and a
 * navigation is a fresh server render. They were hand-cranking this.
 *
 * The app is a WebView on a remote URL, and the OS keeps the page alive
 * across backgrounding. So the sequence is: open the app, look at the
 * drive log, put the phone away, drive, come back, and be shown the
 * render from before the drive. The page never asked the server again,
 * because nothing on it ever does. See lib/mileage/return-refresh.ts for
 * why the drive is genuinely absent at first render (the tail-close rule
 * needs positive evidence the phone is parked, which arrives minutes
 * later) and why this is an event rather than a poll or a timer.
 *
 * This is NOT FinalizeSettleRefresh's job and does not replace it. That
 * one closes a different hole: the render's freshness pass was still
 * running when the page had to go out. It fires at most once, on the way
 * out of a render that reported an outstanding run. This one fires on the
 * way back IN, on a render that was perfectly correct when it shipped and
 * has since gone stale.
 */
export function MileageAutoRefresh() {
  const router = useRouter();

  // When what is on screen was last known good, in the CLIENT's own
  // clock. Deliberately not a server timestamp: comparing a Vercel clock
  // to a phone clock makes device skew, which this codebase already
  // carries handling for elsewhere, into a refresh bug.
  // Null until the effect below stamps the first render. Reading the
  // clock during render is impure (React would be free to re-run it and
  // get a different answer), and an unstamped page is not a stale one, so
  // shouldRefreshOnReturn refuses on null rather than treating it as
  // epoch zero and firing a redundant render on every fresh mount.
  const lastRefreshedAt = useRef<number | null>(null);

  // No dependency array, so this runs after EVERY render, including the
  // one router.refresh() produces and the one a range-pill navigation
  // produces. Fresh data on screen resets the staleness clock, which is
  // what stops a tap that re-rendered the page from being followed by an
  // automatic re-render of the same data.
  useEffect(() => {
    lastRefreshedAt.current = Date.now();
  });

  useEffect(() => {
    const onReturn = () => {
      if (
        !shouldRefreshOnReturn({
          visibility: document.visibilityState,
          nowMs: Date.now(),
          lastRefreshedAtMs: lastRefreshedAt.current,
        })
      )
        return;
      // Stamped before the refresh, not after: visibilitychange and focus
      // both fire when a phone comes forward, and the second must find the
      // clock already reset rather than firing a duplicate render.
      lastRefreshedAt.current = Date.now();
      // refresh(), never location.reload(). refresh() refetches the RSC
      // payload and leaves every client component mounted. A reload would
      // re-run the tracker's arm sequence, whose first act is
      // `await stopBgSafely(bg)`; a backgrounded iOS WebView suspends at
      // that await and never reaches start(), leaving background location
      // down until somebody opens the app by hand. That is the outage
      // PWASetup's visibility gating exists for.
      //
      // Renders now, and once more if this return produced the heartbeat
      // the tail-close rule was waiting on. See runReturnRefresh: without
      // that second render the drive is closed on the server seconds after
      // the page reported it absent, and the driver is back to tapping
      // things. The beat is wall-clock gated, so a return that produced no
      // new evidence costs exactly the one render it always did.
      void runReturnRefresh({
        refresh: () => router.refresh(),
        beat: beatOnForeground,
      });
    };

    // visibilitychange is the event that survives the case this is for:
    // PWASetup's service-worker adoption already depends on it firing
    // when the native shell returns from background. focus is the
    // belt-and-braces second trigger, and covers desktop web, where a
    // window can regain focus without a visibility transition. Both go
    // through the same wall-clock gate, so a doubled event costs nothing.
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [router]);

  return null;
}
