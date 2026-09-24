"use client";

import { useCallback, useMemo, useState } from "react";
import { partitionLoggedTrips } from "@/lib/mileage/passenger";
import { type FilterKey } from "@/lib/mileage/drive-filter";
import type { SentDrive } from "@/app/api/mileage/drives/route";

/**
 * How many consecutive empty pages end the list. See {@link emptyPages}
 * inside the hook for why this is not one.
 */
const END_OF_LIST_EMPTY_PAGES = 2;

/** What a failed load says. Plain, and it names the next action, because
 *  the failure a driver cannot tell from a dead control is the failure
 *  this whole change was about. */
export const LOAD_FAILED = "Could not load older drives. Tap to try again.";

/** The window a reader chose, and the instant they chose it at. */
export type PickedWindow = { key: FilterKey; at: number };

/**
 * The drives a Miles screen holds, the window it is being read through,
 * and the call that appends older pages.
 *
 * ONE implementation for BOTH arms of /mileage. The single-driver log
 * (DriveLog) and the manager's team overlay (TeamLog) ask the same
 * endpoint the same way and have to page it the same way; the team arm
 * shipped with no window control and no way to reach page two at all,
 * which is the "does not react when you click today or this month"
 * complaint left standing on the arm a manager of a 2+ team lands on by
 * default. A second copy of the cursor rule is also how a tie-break
 * quietly goes missing on one screen and not the other.
 */
export function useDriveWindow({
  initialDrives,
  initialExcluded = EMPTY,
  companyId,
  driverParam,
}: {
  /** The newest page, from the server, on every render. */
  initialDrives: SentDrive[];
  /** The same page's passenger drives, when the caller partitions. */
  initialExcluded?: SentDrive[];
  companyId: string;
  /** The teammate the log was read under, forwarded verbatim. The route
   *  launders it through the same resolveTripScope the page used, so
   *  page two is scoped exactly like page one. */
  driverParam: string;
}) {
  /**
   * WHO OWNS THE LIST, and why this is not `useState(initialDrives)`.
   *
   * The server owns page one. The client owns only the pages it
   * appended. Seeding state from the prop once and never resyncing
   * latches the FIRST server payload for the lifetime of the mount, and
   * every `revalidatePath("/mileage")` after that is thrown away: the
   * reclassify action succeeds, the page re-renders with the new row,
   * the component keeps the old one, and the row stays
   * `aria-pressed="false"` with the total at zero and no deduction. A
   * deleted drive stays in the list for the same reason. The only thing
   * that moved was the head's waiting count, because that is a
   * pass-through prop and never went through the latch, so the number
   * dropped while the row it pointed at did not change: the owner's own
   * "does not react when you click" complaint, rebuilt on the control
   * the whole screen was reorganised around.
   *
   * KNOWN RESIDUAL, stated rather than hidden: a revalidate refreshes
   * page one only, so a drive on an APPENDED page keeps the
   * classification and the deduction it was fetched with until the log
   * is reloaded. Reclassifying it is not faked locally, because nothing
   * here knows the IRS rate for the drive's tax year and a deduction
   * invented on the client is worse than one that has not refreshed yet.
   * The drives that want a decision are overwhelmingly the newest ones,
   * which are page one.
   */
  const [appended, setAppended] = useState<SentDrive[]>([]);
  const [appendedExcluded, setAppendedExcluded] = useState<SentDrive[]>([]);
  const drives = useMemo(
    () => append(initialDrives, appended),
    [initialDrives, appended],
  );
  const excluded = useMemo(
    () => append(initialExcluded, appendedExcluded),
    [initialExcluded, appendedExcluded],
  );

  /**
   * The chosen window, and the instant it was chosen at.
   *
   * Held HERE, once. It used to live in two components at the same time,
   * each reading its own `Date.now()` and staying in step only because
   * one handler happened to call the other. One control, one owner.
   *
   * The clock is read in the tap handler rather than during render: a
   * re-render is not an event, and re-reading the clock on every one
   * moves the window boundary under a list somebody is reading. "All"
   * spans every instant, so the initial value needs no clock read.
   */
  const [picked, setPicked] = useState<PickedWindow>({ key: "all", at: 0 });
  const pick = useCallback(
    (key: FilterKey) => setPicked({ key, at: Date.now() }),
    [],
  );

  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  /**
   * THE END-OF-LIST SIGNAL: TWO well-formed pages in a row that came back
   * with zero drives.
   *
   * Not `page.length < DRIVE_PAGE_SIZE`. loadDrivePage pages on a tuple
   * cursor and drops the rows it has already shown, so a cluster of
   * drives sharing one instant can return a short page that is not the
   * end at all. Treating short as final would hide every drive behind
   * such a cluster, permanently, with no error anywhere to say so.
   *
   * And not ONE empty page either, which is what this held first. An
   * empty array is not always an answer: loadScopedTrips swallows a
   * Supabase error into `data ?? []` (lib/mileage/team-scope.ts) and the
   * route answers `{ drives: [] }` when a membership does not resolve, so
   * a 200 carrying nothing can be a blip rather than the end of the log.
   * Latching on the first one meant a single blip switched "load more"
   * off for the rest of the session, silently, with no way back short of
   * a reload. One empty page is "none right now" and leaves the control
   * usable; two consecutive ones are the end. A page with drives in it
   * clears the count, and a failure never touches it at all, because a
   * request that did not answer has said nothing about what is left.
   */
  const [emptyPages, setEmptyPages] = useState(0);
  const atEnd = emptyPages >= END_OF_LIST_EMPTY_PAGES;

  const load = useCallback(async () => {
    if (loadingOlder || atEnd) return;
    setOlderError(null);
    // The cursor is the oldest row HELD, across both halves. A passenger
    // drive is out of the log but it is still a row the previous page
    // returned, so cursoring past it would ask the server for drives it
    // has already sent.
    const oldest = oldestOf([...drives, ...excluded]);
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      // A TUPLE cursor. `beforeId` is not decoration: without it, two
      // drives that started in the same millisecond, which is ordinary at
      // GPS precision, straddle the page boundary and whichever one was
      // not already on screen is skipped for good. See
      // lib/mileage/drive-page.ts.
      const qs = new URLSearchParams({
        company: companyId,
        before: oldest.started_at,
        beforeId: oldest.id,
      });
      if (driverParam) qs.set("driver", driverParam);
      const res = await fetch(`/api/mileage/drives?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setOlderError(LOAD_FAILED);
        return;
      }
      const body = (await res.json()) as { drives?: unknown };
      // A well-formed answer is an ARRAY. Anything else, including a
      // `{ error }` body the route returns with a 200, is not an answer
      // about what is left in the log and must not count towards the end
      // of it.
      if (!Array.isArray(body.drives)) {
        setOlderError(LOAD_FAILED);
        return;
      }
      const page = body.drives as SentDrive[];
      if (page.length === 0) {
        setEmptyPages((n) => n + 1);
        return;
      }
      setEmptyPages(0);
      // The route does not partition, so this page does it on arrival:
      // without it, a drive the driver already said they were riding in
      // would walk straight back into the log.
      const split = partitionLoggedTrips(page);
      setAppended((prev) => append(prev, split.logged));
      setAppendedExcluded((prev) => append(prev, split.excluded));
    } catch {
      // A rejected fetch is an offline phone or a dropped connection, and
      // it was previously unhandled: the promise rejected, the spinner
      // never cleared and nothing on screen said a word.
      setOlderError(LOAD_FAILED);
    } finally {
      setLoadingOlder(false);
    }
  }, [atEnd, companyId, driverParam, drives, excluded, loadingOlder]);

  return {
    drives,
    excluded,
    picked,
    pick,
    /** Undefined at the end of the list, which is how the control knows
     *  not to offer a tap that has nothing left to fetch. */
    loadOlder: atEnd ? undefined : load,
    loadingOlder,
    olderError,
  };
}

const EMPTY: SentDrive[] = [];

/**
 * The oldest row of a set, by start instant, with the smaller id
 * breaking a tie.
 *
 * The tie-break matches lib/mileage/drive-page.ts, which sorts ties by id
 * DESCENDING, so the last row of a tied cluster is the one with the
 * smallest id. Picking any other member of the cluster as the cursor
 * would ask the server to re-send the rest of it.
 */
function oldestOf(rows: readonly SentDrive[]): SentDrive | null {
  let best: SentDrive | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const at = new Date(row.started_at).getTime();
    if (Number.isNaN(at)) continue;
    if (at < bestAt || (at === bestAt && best !== null && row.id < best.id)) {
      best = row;
      bestAt = at;
    }
  }
  return best;
}

/** Append, dropping any id already held. A double tap or an overlapping
 *  cursor would otherwise give React two rows with the same key and the
 *  reader the same drive twice. */
function append(prev: SentDrive[], incoming: SentDrive[]): SentDrive[] {
  const held = new Set(prev.map((d) => d.id));
  const fresh = incoming.filter((d) => !held.has(d.id));
  return fresh.length === 0 ? prev : [...prev, ...fresh];
}
