"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type RosterRow = {
  userId: string;
  name: string;
  /** Raw per-company override (null = name falls back to the member's
   *  own profile). Kept separate from `name` so the edit form can show
   *  the override as the value and the profile name as the placeholder. */
  displayName: string | null;
  email: string;
  employeeNumber: number | null;
  title: string | null;
  roleLabel: string;
  departmentId: string | null;
  departmentName: string | null;
  expenseLabel: string;
  mileageLabel: string;
  isSelf: boolean;
};

type Props = {
  members: RosterRow[];
  departments: { id: string; name: string }[];
  companyId: string;
  publicId: string;
  isManager: boolean;
  assignMemberDepartment: (formData: FormData) => Promise<void>;
  updateMemberDetails: (formData: FormData) => Promise<void>;
  removeMember: (formData: FormData) => Promise<void>;
};

/**
 * Team roster with a name/title search box and a department filter -
 * a flat, unfiltered <ul> reads fine for a handful of teammates but
 * becomes an unscannable wall at real scale (a manager running 100
 * employees). Filtering happens client-side against the already-fetched
 * roster (cheap at this size, no extra round-trip per keystroke).
 */
export function TeamRoster({
  members,
  departments,
  companyId,
  publicId,
  isManager,
  assignMemberDepartment,
  updateMemberDetails,
  removeMember,
}: Props) {
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  // userId of the row whose details form is open (one at a time).
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (deptFilter === "unassigned" && m.departmentId) return false;
      if (
        deptFilter !== "all" &&
        deptFilter !== "unassigned" &&
        m.departmentId !== deptFilter
      )
        return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        (m.title ?? "").toLowerCase().includes(q)
      );
    });
  }, [members, query, deptFilter]);

  const showFilters = members.length > 8;

  return (
    <div>
      {showFilters ? (
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or title"
            className="input flex-1"
          />
          {departments.length > 0 ? (
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="input sm:w-52"
            >
              <option value="all">All departments</option>
              <option value="unassigned">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}

      {showFilters ? (
        <div className="mb-2 text-xs text-ink-muted">
          {filtered.length} of {members.length} teammates
        </div>
      ) : null}

      <ul className="grid gap-2">
        {filtered.length === 0 ? (
          <li className="text-sm text-ink-muted px-1 py-3">
            No one matches that search.
          </li>
        ) : (
          filtered.map((m) => (
            <li
              key={m.userId}
              className="rounded-lg border border-forest-100 bg-white/60 px-4 py-3 text-sm"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-forest-900 truncate">
                    {m.name}
                    {isManager ? (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingId((v) => (v === m.userId ? null : m.userId))
                        }
                        className="ml-2 text-xs font-normal text-gold-800 hover:text-gold-900 underline underline-offset-2"
                        aria-expanded={editingId === m.userId}
                      >
                        {editingId === m.userId ? "Close" : "Edit"}
                      </button>
                    ) : null}
                  </div>
                  {isManager && editingId === m.userId ? (
                    <form
                      action={async (fd) => {
                        await updateMemberDetails(fd);
                        setEditingId(null);
                      }}
                      className="mt-2 grid gap-1.5 sm:grid-cols-[1fr_1fr_auto] sm:items-end max-w-md"
                    >
                      <input type="hidden" name="company_id" value={companyId} />
                      <input type="hidden" name="user_id" value={m.userId} />
                      <label className="grid gap-1 min-w-0">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
                          Display name
                        </span>
                        <input
                          name="display_name"
                          defaultValue={m.displayName ?? ""}
                          placeholder={m.name}
                          maxLength={120}
                          className="input h-8 text-xs py-0"
                        />
                      </label>
                      <label className="grid gap-1 min-w-0">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
                          Job title
                        </span>
                        <input
                          name="title"
                          defaultValue={m.title ?? ""}
                          placeholder="e.g. Lead photographer"
                          maxLength={120}
                          className="input h-8 text-xs py-0"
                        />
                      </label>
                      <button className="btn-ghost text-xs h-8 px-3 justify-self-start">
                        Save
                      </button>
                      <p className="sm:col-span-3 text-[10px] text-ink-muted leading-relaxed">
                        Changes how they appear in this company only. Leave the
                        name blank to use their own profile name.
                      </p>
                    </form>
                  ) : null}
                  <div className="text-xs text-ink-muted mt-0.5">
                    {[
                      m.employeeNumber
                        ? `EMP-${String(m.employeeNumber).padStart(3, "0")}`
                        : null,
                      m.title,
                      m.roleLabel,
                      m.departmentName,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {isManager && departments.length > 0 ? (
                    <form
                      action={assignMemberDepartment}
                      className="mt-1.5 flex items-center gap-1.5"
                    >
                      <input type="hidden" name="company_id" value={companyId} />
                      <input type="hidden" name="user_id" value={m.userId} />
                      <select
                        name="department_id"
                        defaultValue={m.departmentId ?? ""}
                        className="input h-7 text-xs py-0"
                      >
                        <option value="">No department</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <button className="text-xs text-gold-800 hover:text-gold-900 shrink-0">
                        Save
                      </button>
                    </form>
                  ) : null}
                </div>
                {isManager ? (
                  <div className="flex items-center gap-4 shrink-0 flex-wrap">
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
                        Expenses
                      </div>
                      <div className="text-sm text-forest-900 tabular-nums">
                        {m.expenseLabel}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
                        Business miles
                      </div>
                      <div className="text-sm text-forest-900 tabular-nums">
                        {m.mileageLabel}
                      </div>
                    </div>
                    <Link
                      href={`/c/${publicId}/expenses?emp=${m.userId}`}
                      className="text-xs text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2 whitespace-nowrap"
                    >
                      View expenses &rarr;
                    </Link>
                    {!m.isSelf ? (
                      <form action={removeMember}>
                        <input type="hidden" name="company_id" value={companyId} />
                        <input type="hidden" name="user_id" value={m.userId} />
                        <button className="text-xs text-red-700 hover:text-red-900">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
