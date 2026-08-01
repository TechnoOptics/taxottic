"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SelectMenu, type SelectOption } from "@/components/ui/SelectMenu";
import { ALL_DRIVERS } from "@/lib/mileage/team-scope";

/**
 * Manager-only driver switcher for the mileage map. A company manager
 * can review any teammate's drive log, pick a person and the whole
 * page (map, trip list, stats) re-scopes to their trips via `?driver=`.
 *
 * The control is rendered by the page only when the viewer is a manager AND
 * the company has ≥2 members, so a solo driver never sees it.
 *
 * "All drivers" overlays every teammate's trails on the map, each in its own
 * colour and numbered, as a read-only team view (per-trip reclassify /
 * delete still happen from a single driver's log, not the overlay).
 * Otherwise the map plots one driver's route at a time.
 *
 * Since August 2026 the team overlay is the manager's DEFAULT, so every
 * selection, including picking yourself, writes an explicit `?driver=`.
 * Clearing the param, as this used to do for self, would now bounce the
 * manager straight back to the team view and leave them unable to reach
 * their own log.
 */
export { ALL_DRIVERS };

export function DriverPicker({
  selfUserId,
  drivers,
  current,
}: {
  selfUserId: string;
  drivers: { userId: string; label: string }[];
  /** Currently-viewed driver id, or "all" for the team overlay. */
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const options: SelectOption[] = [
    { value: ALL_DRIVERS, label: "All drivers" },
    ...drivers.map((d) => ({ value: d.userId, label: d.label })),
  ];

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    // Always explicit: no param now means "the whole team", so selecting
    // yourself has to say so. `selfUserId` is still what tells us which
    // option that is.
    params.set("driver", value || selfUserId);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-[0.2em] text-gold-700 whitespace-nowrap">
        Driver
      </span>
      <SelectMenu
        ariaLabel="View another driver's drives"
        value={current}
        onValueChange={onChange}
        options={options}
        buttonClassName="h-9 text-sm min-w-[12rem]"
      />
    </div>
  );
}
