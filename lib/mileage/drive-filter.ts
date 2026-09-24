/**
 * The range control's logic, run in the browser over the drives that are
 * already loaded.
 *
 * It used to be four `<Link href="/mileage?range=...">` on a
 * force-dynamic page. A tap started a full server render with no pending
 * state, so nothing on screen moved until the render came back, which is
 * the "tapping Today or This month does not react" report. Nothing here
 * touches the network, so the control answers on the tap.
 */
export type FilterKey = "all" | "week" | "month" | "quarter";

const DAYS: Record<Exclude<FilterKey, "all">, number> = {
  week: 7,
  month: 31,
  quarter: 92,
};

export const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  week: "Last 7 days",
  month: "Last 31 days",
  quarter: "Last 92 days",
};

function startOf(key: FilterKey, now: number): number {
  if (key === "all") return Number.NEGATIVE_INFINITY;
  return now - DAYS[key] * 86_400_000;
}

export function filterDrives<T extends { started_at: string }>(
  drives: T[],
  key: FilterKey,
  now: number,
): T[] {
  const from = startOf(key, now);
  return drives.filter((d) => new Date(d.started_at).getTime() >= from);
}

/**
 * False when the window starts before the oldest drive we hold, so the
 * control can offer to load older instead of implying the list is the
 * whole truth. Filtering in the browser is what makes a tap instant;
 * this is the honesty that buys.
 */
export function coversWindow<T extends { started_at: string }>(
  drives: T[],
  key: FilterKey,
  now: number,
): boolean {
  if (key === "all" || drives.length === 0) return true;
  const oldest = Math.min(...drives.map((d) => new Date(d.started_at).getTime()));
  return oldest <= startOf(key, now);
}
