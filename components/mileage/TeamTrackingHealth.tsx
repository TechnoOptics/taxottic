import { describeDriveHealth, type DriveTrackingHealth } from "@/lib/mileage/device-health";
import { describeDeviceCause, type DeviceCause } from "@/lib/mileage/device-cause";
import { ChevronDownIcon, WarningIcon } from "@/components/ui/Icons";

type Row = {
  userId: string;
  label: string;
  health: { status: DriveTrackingHealth; ageMs: number | null };
  /** What that phone's own status row says is wrong, when it knows.
   *  Rendered on the row so the manager can tell the driver what to
   *  fix; the generic prose below is only the fallback for a row that
   *  does not know. */
  cause?: DeviceCause | null;
  platform?: string | null;
};

/**
 * Manager-only "is everyone's phone actually tracking?" card.
 *
 * The gap this closes: nothing surfaced that a driver's device had gone
 * dark (or was uploading from a phone that never moves) until someone
 * noticed missing drives a week later. This puts every driver's live
 * tracking state in front of the manager on the page they already open
 * to review drives. Computed from raw uploads, so it is accurate even
 * for a teammate on an old build.
 *
 * Only rendered when at least one driver needs attention, so a healthy
 * team adds no noise.
 *
 * One line until tapped. It is an alert about SOMEONE ELSE'S phone,
 * rendered at the top of the manager's own drive log on every visit, and
 * at full size on a Fold cover screen it pushed the range pills and the
 * map below the fold: the driver "clicked around hoping the drive would
 * show up" when the drive was there all along. The headline and the
 * count stay on the line so it still reads as an alert; the list and the
 * wording, unchanged, are one tap away.
 */
export function TeamTrackingHealth({ rows }: { rows: Row[] }) {
  const attention = rows.filter(
    (r) =>
      r.health.status === "silent" ||
      r.health.status === "parked" ||
      r.health.status === "blocked",
  );
  if (attention.length === 0) return null;

  // One fix sentence per distinct cause, not per driver: two phones on
  // While Using need the same path once. The short cause sits on each
  // driver's row (one line, measured at 344px in
  // MileageFirstPaint.ct.spec.tsx); the path lives here below the list.
  const fixes = Array.from(
    new Set(
      attention.flatMap((r) => {
        if (!r.cause) return [];
        const t = describeDeviceCause(r.cause, r.platform ?? null, "manager");
        return [`${t.short}. ${t.fix} `];
      }),
    ),
  );

  return (
    <details className="group mx-0 mt-4 rounded-2xl border border-amber-300 bg-amber-50">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-4 py-2.5">
        <WarningIcon className="size-4 shrink-0 text-amber-800" />
        <h2 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-amber-900">
          Some devices aren&apos;t tracking
        </h2>
        <span className="whitespace-nowrap text-[11px] uppercase tracking-wide text-amber-700">
          {attention.length} of {rows.length}
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-amber-800 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4">
        <ul className="mt-1 space-y-2">
          {attention.map((r) => {
            const name = r.label.split(" · ")[0];
            const silent = r.health.status === "silent";
            const cause = r.cause
              ? describeDeviceCause(r.cause, r.platform ?? null, "manager")
              : null;
            return (
              <li key={r.userId} className="rounded-lg bg-white/70 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-amber-950">{name}</span>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        silent || r.health.status === "blocked"
                          ? "bg-red-500"
                          : "bg-amber-500"
                      }`}
                      aria-hidden
                    />
                    <span className="text-xs font-medium text-amber-900">
                      {describeDriveHealth(r.health)}
                    </span>
                  </span>
                </div>
                {cause ? (
                  <p className="mt-0.5 truncate text-xs text-amber-800">{cause.short}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-amber-800">
          {fixes.join("")}
          {attention.some((r) => r.health.status === "silent" && r.cause == null)
            ? "Silent means the phone stopped uploading, usually location permission dropped to “While Using” or the app was force-closed. "
            : ""}
          {attention.some((r) => r.health.status === "blocked")
            ? "Background refresh off means iOS will not wake Taxottic for any drive. That phone cannot track until it is turned back on in Settings > General > Background App Refresh. "
            : ""}
          {attention.some((r) => r.health.status === "parked")
            ? "Parked means the phone is uploading but hasn’t moved in days, it may not be the device that person drives with. "
            : ""}
          Ask them to open Taxottic, update if prompted, and confirm location is set to Always.
        </p>
      </div>
    </details>
  );
}
