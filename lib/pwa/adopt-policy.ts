/**
 * When may the page adopt a waiting service worker?
 *
 * Adopting posts SKIP_WAITING, which fires controllerchange, which reloads
 * the page. On this app a reload is never free: the mileage tracker is armed
 * from the page, and native-tracker's arm path calls `await stopBgSafely(bg)`
 * to clear an orphaned service BEFORE it calls `bg.start()`. A fresh page life
 * booting in a backgrounded iOS WebView therefore stops the live background
 * location service, then gets suspended by iOS at that await, so start() never
 * runs. Tracking stays off until the user next opens the app by hand.
 *
 * This is not hypothetical. Grace's iPhone logged 284 background heartbeats on
 * 1.3.6, then exactly one on 1.3.7 (the release that began adopting while
 * hidden) before going silent for four days. Every contact afterwards was
 * foreground only, in bursts of 2 to 5 points: the signature of a tracker that
 * only arms while someone is looking at the screen.
 *
 * The rule is therefore: adopt only while the page is VISIBLE. A worker that
 * installs while hidden stays waiting and is taken on the next foreground,
 * which preserves the property that a fix reaches the device without anyone
 * tapping an update toast.
 *
 * Kept as a pure function, separate from the component, so the invariant is
 * covered by a node test rather than resting on a one-line guard nobody checks.
 */
export function shouldAdoptWaitingWorker(opts: {
  /** document.visibilityState at the moment adoption is considered. */
  visibility: DocumentVisibilityState;
  /** True once this page life has already posted SKIP_WAITING. */
  alreadyAdopted: boolean;
  /** False when there is no waiting worker to take. */
  hasWaitingWorker: boolean;
}): boolean {
  if (!opts.hasWaitingWorker) return false;
  // One adopt per page life. Adopting reloads, and a reload starts a fresh
  // life, so this never blocks a genuine second update.
  if (opts.alreadyAdopted) return false;
  // The load-bearing clause. Reloading a hidden page disarms the tracker.
  return opts.visibility === "visible";
}
