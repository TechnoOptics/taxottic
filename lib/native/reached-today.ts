export const REACHED_TODAY_KEY = "taxottic.native.reached_today";
export const REACHED_TODAY_EVENT = "taxottic:reached-today";

/** Called by the dashboard on mount; the init listens for the event. */
export function markReachedToday(): void {
  try {
    if (localStorage.getItem(REACHED_TODAY_KEY) === "1") return;
    localStorage.setItem(REACHED_TODAY_KEY, "1");
  } catch {
    /* storage unavailable: the event still fires for this session */
  }
  window.dispatchEvent(new Event(REACHED_TODAY_EVENT));
}

export function hasReachedToday(): boolean {
  try {
    return localStorage.getItem(REACHED_TODAY_KEY) === "1";
  } catch {
    return false;
  }
}
