"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SelectMenu, type SelectOption } from "@/components/ui/SelectMenu";

/**
 * Manager-only driver switcher for the mileage map. A company manager
 * can review any teammate's drive log — pick a person and the whole
 * page (map, trip list, stats) re-scopes to their trips via `?driver=`.
 *
 * Picking yourself clears the param so `/mileage` stays the canonical
 * "my own drives" URL. The control is rendered by the page only when the
 * viewer is a manager AND the company has ≥2 members, so a solo driver
 * never sees it.
 *
 * Unlike the Expenses EmployeeFilter there is no "everyone" option: the
 * map plots one driver's route at a time, and reclassify/delete act on a
 * specific trip's owner. Default selection is always the viewer.
 */
export function DriverPicker({
  selfUserId,
  drivers,
  current,
}: {
  selfUserId: string;
  drivers: { userId: string; label: string }[];
  /** Currently-viewed driver id (defaults to selfUserId). */
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const options: SelectOption[] = drivers.map((d) => ({
    value: d.userId,
    label: d.label,
  }));

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    // Self is the canonical default → drop the param entirely.
    if (!value || value === selfUserId) params.delete("driver");
    else params.set("driver", value);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
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
