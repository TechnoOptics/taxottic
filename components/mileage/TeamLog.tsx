"use client";

import { type ReactNode } from "react";
import { DriveFilter } from "@/components/mileage/DriveFilter";
import { MilesHead } from "@/components/mileage/MilesHead";
import {
  MileageMapRoutes,
  type MapPlace,
  type MapTrip,
  type RoutelessTrip,
} from "@/components/mileage/MileageMap";
import { filterDrives } from "@/lib/mileage/drive-filter";
import { splitScheduleC } from "@/lib/mileage/schedule-c-totals";
import { useDriveWindow } from "@/components/mileage/useDriveWindow";
import type { SentDrive } from "@/app/api/mileage/drives/route";

/** How tall the overlay map is. Unchanged from the server render it
 *  replaced; it is the largest thing on a manager's screen. */
const MAP_HEIGHT = 460;

/**
 * The manager's team overlay: every driver's trails in their own colour,
 * a per-driver rollup, and the SAME window control the single-driver log
 * has.
 *
 * WHY THIS EXISTS. When the range links became a client filter, this arm
 * lost the four pills and got nothing back: a manager of a 2+ team, who
 * lands here by default, saw the newest sixty drives on a map with no
 * way to narrow them and no way to reach page two at all. That is the
 * owner's "does not react when you click today or this month" complaint
 * still standing, on the arm he is most likely to open.
 *
 * It holds no per-trip triage. Reclassify, delete and "I was a
 * passenger" stay on a single driver's log, because this list mixes
 * owners and those actions belong to the person who drove. The way to
 * one driver is the picker on the identity line.
 *
 * The map, the rollup and the total all read the SAME filtered set, so a
 * tap moves every one of them together. A total that describes a
 * different set than the map beside it reads as authoritative and is
 * wrong on the first tap.
 */
export function TeamLog({
  who,
  where,
  awaiting,
  switcher,
  tracking,
  initialDrives,
  companyId,
  driverParam,
  places,
  driverNames,
}: {
  who: string;
  where?: string;
  awaiting: number;
  switcher?: ReactNode;
  tracking?: ReactNode;
  /** The newest page of the TEAM's drives: the viewer's own plus every
   *  teammate's confirmed business drives, scoped and sorted by the
   *  server (lib/mileage/team-scope.ts). */
  initialDrives: SentDrive[];
  companyId: string;
  driverParam: string;
  places: MapPlace[];
  /** Driver id to display name, for the legend and the rollup. A driver
   *  with no entry is labelled "Driver" rather than a uuid. */
  driverNames: Record<string, string>;
}) {
  const { drives, picked, pick, loadOlder, loadingOlder, olderError } =
    useDriveWindow({ initialDrives, companyId, driverParam });

  const shown = filterDrives(drives, picked.key, picked.at);

  // Confirmed business drives only, through the same splitScheduleC the
  // single-driver head uses: a machine guess must not become a tax
  // figure before a human agrees with it (#616).
  const totals = splitScheduleC(
    shown.filter((d) => d.classification === "business"),
  );

  // The map has no colour for a passenger drive because it must never
  // draw one, and a runtime check means a future edit cannot put one on
  // the map. A teammate's row can never be a passenger drive anyway, so
  // everything this drops is the viewer's own.
  const mapTrips: RoutelessTrip[] = shown
    .filter(
      (d): d is SentDrive & { classification: MapTrip["classification"] } =>
        d.classification !== "passenger",
    )
    .map((d) => ({
      id: d.id,
      classification: d.classification,
      // `notes` travels in TRIP_SELECT and is read through a cast for
      // the same reason the page reads it through one: the row type does
      // not declare it.
      approximate: ((d as { notes?: string | null }).notes ?? "").startsWith(
        "Approximate drive",
      ),
      driverId: d.driver_user_id ?? null,
      driverName: driverNames[d.driver_user_id ?? ""] ?? null,
    }));

  const rollup = rollUpByDriver(shown, driverNames);

  return (
    <>
      <MilesHead
        who={who}
        where={where}
        miles={totals.settledMiles}
        deductionCents={totals.settledCents}
        driveCount={shown.length}
        awaiting={awaiting}
        /* No `waitingHref`: the anchor lives among rendered drive rows
           and this arm renders none, so the count goes to the deck. */
        switcher={switcher}
        tracking={tracking}
      />
      <div className="mt-4">
        <DriveFilter
          drives={drives}
          picked={picked}
          onChange={pick}
          onLoadOlder={loadOlder}
          loadingOlder={loadingOlder}
          olderError={olderError}
        />
      </div>
      <div className="mt-4">
        <MileageMapRoutes
          trips={mapTrips}
          places={places}
          height={MAP_HEIGHT}
          /* The overlay's whole job is EVERY driver's trail. The polyline
             route serves a batch that names no company strictly to the
             caller, so without this the map draws the manager's own and
             nothing else while the legend still names the drivers who
             have none. The scope is resolved on the server from the
             caller's own membership. */
          scope={{ companyId, driverParam }}
        />
      </div>
      {rollup.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {rollup.map((d) => (
            <li
              key={d.id}
              className="card p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-forest-900 truncate">
                  {d.label}
                </div>
                <div className="text-xs text-ink-muted mt-0.5">
                  {d.trips} trip{d.trips === 1 ? "" : "s"} ·{" "}
                  {fmtMiles(d.miles)} business mi
                </div>
              </div>
              <div className="display text-lg text-forest-900 tabular-nums">
                {fmtUsd(d.deduction)}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Business miles and deduction per teammate, largest deduction first.
 *  Computed over the FILTERED drives, so a window tap moves the rollup
 *  with the map it sits under. */
function rollUpByDriver(
  drives: readonly SentDrive[],
  names: Record<string, string>,
) {
  const by = new Map<
    string,
    { miles: number; deduction: number; trips: number }
  >();
  for (const t of drives) {
    const k = t.driver_user_id ?? "";
    const cur = by.get(k) ?? { miles: 0, deduction: 0, trips: 0 };
    cur.trips += 1;
    if (t.classification === "business") {
      cur.miles += Number(t.distance_miles);
      cur.deduction += Number(t.deduction_cents);
    }
    by.set(k, cur);
  }
  return Array.from(by.entries())
    .map(([id, agg]) => ({ id, label: names[id] ?? "Driver", ...agg }))
    .sort((a, b) => b.deduction - a.deduction);
}

function fmtMiles(m: number) {
  return m.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function fmtUsd(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
