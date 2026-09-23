import type { SupabaseClient } from "@supabase/supabase-js";
import { loadScopedTrips, type TripScope } from "./team-scope";

/**
 * How many drives the first paint carries.
 *
 * The range control filters what is already loaded, so this number
 * decides which filters answer without a network call. Sixty covers a
 * month of heavy driving, which is every filter the control offers
 * except Quarter on a busy account, and stays one cheap indexed read.
 */
export const DRIVE_PAGE_SIZE = 60;

/**
 * A floor that excludes nothing.
 *
 * loadScopedTrips takes a required sinceIso because its three other
 * callers are windowed. This page is not: it opens on the newest drives
 * whenever they happened, because defaulting to Today showed a blank
 * screen to a driver whose fixes had not finished uploading, which is
 * the 24 hour median on Android.
 */
const NO_FLOOR_ISO = "1970-01-01T00:00:00.000Z";

type DriveRow = { started_at: string; id: string };

/**
 * A row's position on the timeline, or null when `started_at` cannot be
 * parsed.
 *
 * Rows that fail to parse are DROPPED rather than sorted to either end
 * (see {@link sortNewestFirst}): this page's only promise is "the newest
 * drives, newest first", and a row this function cannot place on that
 * axis cannot honour the promise in either position. `mileage_trips
 * .started_at` is `NOT NULL timestamptz` in the schema
 * (supabase/migrations/20260514000016_mileage_tracker.sql), so this is a
 * defensive guard against a malformed row, not an expected path.
 */
function instantOf(row: { started_at: string }): number | null {
  const t = new Date(row.started_at).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Newest first, with a deterministic tie-break by id (descending) when two
 * rows share an instant.
 *
 * The tie-break matters beyond cosmetics: {@link isOlderThanCursor} below
 * excludes rows by comparing against this same ordering, so pagination can
 * only be correct if every page sorts tied rows the same way. Applied
 * unconditionally, not only when paging, so the very first load is also
 * capped and ordered correctly for a scope (`team`) whose source rows
 * arrive as an unsorted, over-sized concatenation.
 */
function sortNewestFirst<T extends DriveRow>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => instantOf(r) !== null)
    .sort((a, b) => {
      const byTime = (instantOf(b) as number) - (instantOf(a) as number);
      if (byTime !== 0) return byTime;
      if (a.id === b.id) return 0;
      return a.id < b.id ? 1 : -1;
    });
}

/**
 * True when `row` sorts strictly after the cursor in
 * {@link sortNewestFirst}'s order, i.e. it belongs on a page older than
 * the one the cursor came from.
 *
 * The cursor is a tuple, `(before, beforeId)`, not a bare timestamp: two
 * drives that started in the same instant are common enough at
 * millisecond GPS precision that a timestamp-only cursor would drop
 * whichever one of the pair had not already been shown, permanently, the
 * moment the other crossed a page boundary. When `beforeId` is not
 * supplied (a plain `before` cursor with no known tie), a row that ties
 * `before` exactly is excluded, matching the simple "strictly before"
 * reading of a bare ISO cursor.
 */
function isOlderThanCursor(
  row: DriveRow,
  cursor: { before: string; beforeId?: string },
): boolean {
  const rowInstant = instantOf(row);
  if (rowInstant === null) return false;
  const cursorInstant = new Date(cursor.before).getTime();
  if (rowInstant !== cursorInstant) return rowInstant < cursorInstant;
  // Same instant as the cursor. Only "older" (i.e. already shown) if we
  // can rank it against the exact row the previous page ended on. No
  // beforeId means no known tie-break, so an exact tie is treated as NOT
  // older, the same reading a bare "strictly before" ISO cursor gives the
  // row that IS the cursor.
  if (cursor.beforeId === undefined) return false;
  return row.id < cursor.beforeId;
}

export async function loadDrivePage<T extends DriveRow>(
  admin: SupabaseClient,
  {
    companyId,
    scope,
    before,
    beforeId,
    limit = DRIVE_PAGE_SIZE,
  }: {
    companyId: string;
    scope: TripScope;
    /** ISO cursor: only drives older than this are returned. */
    before?: string;
    /** Tie-breaker for drives that share `before`'s instant exactly. */
    beforeId?: string;
    limit?: number;
  },
): Promise<T[]> {
  const rows = await loadScopedTrips<T>(admin, {
    companyId,
    scope,
    sinceIso: NO_FLOOR_ISO,
    // Inclusive DB-side upper bound: it is what makes a later page
    // actually narrower than the first (loadScopedTrips otherwise has no
    // upper bound at all and every page would re-fetch the same newest
    // rows). Inclusive rather than strict so a row tied with the cursor
    // survives the DB round trip; the precise, id-aware exclusion happens
    // below, once, after every source is merged and sorted the same way.
    beforeIso: before,
    // One extra when paging: the inclusive DB-side bound above always
    // re-fetches the exact cursor row (see beforeIso's doc comment in
    // team-scope.ts), and this page discards it below. Without the extra
    // slot, every "load older" call would come back one row short.
    limit: before ? limit + 1 : limit,
  });
  const sorted = sortNewestFirst(rows);
  const paged = before
    ? sorted.filter((r) => isOlderThanCursor(r, { before, beforeId }))
    : sorted;
  return paged.slice(0, limit);
}
