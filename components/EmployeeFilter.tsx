"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SelectMenu, type SelectOption } from "@/components/ui/SelectMenu";

/**
 * "Whose entries am I looking at?" filter for company lists that carry a
 * per-user association (Expenses → monthly_expenses.user_id). A company
 * with W-2 employees / multiple members wants to see one teammate's
 * activity at a time, e.g. "show me just Maria's expenses." The control
 * only renders when the parent decides there are ≥2 members, so a
 * solo-operator company never sees it.
 *
 * Controlled SelectMenu (no hidden form input) that drives navigation:
 * picking an option rewrites the `?emp=` search param via the router,
 * preserving any other params already on the URL. "All team members"
 * clears the param entirely.
 */
export type EmployeeOption = {
  /** auth user id (monthly_expenses.user_id / mileage_trips.driver_user_id). */
  userId: string;
  label: string;
};

export function EmployeeFilter({
  members,
  current,
  paramName = "emp",
  allLabel = "All team members",
}: {
  members: EmployeeOption[];
  /** Currently-selected user id, or "" for everyone. */
  current: string;
  paramName?: string;
  allLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const options: SelectOption[] = [
    { value: "", label: allLabel },
    ...members.map((m) => ({ value: m.userId, label: m.label })),
  ];

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value) params.set(paramName, value);
    else params.delete(paramName);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-[0.2em] text-gold-700 whitespace-nowrap">
        Showing
      </span>
      <SelectMenu
        ariaLabel="Filter by team member"
        value={current}
        onValueChange={onChange}
        options={options}
        buttonClassName="h-9 text-sm min-w-[12rem]"
      />
    </div>
  );
}
