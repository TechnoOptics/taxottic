"use client";

import { useState } from "react";
import type {
  DayKey,
  MileageSchedule,
  Window,
} from "@/lib/mileage/schedule";
import {
  DAYS,
  DAY_LABEL,
  defaultCustomWindows,
} from "@/lib/mileage/schedule";

type Mode = "always" | "weekdays" | "custom";

type Props = {
  initial: MileageSchedule | null;
  action: (formData: FormData) => void;
};

/** Three-mode schedule editor.
 *
 * Always-on  → one big radio, nothing else.
 * Weekdays   → from/to time inputs (default 09:00–17:00).
 * Custom     → 7 day rows, each with a checkbox + from/to pair when
 *              enabled.
 *
 * Form submission is a plain server action so this page stays
 * server-rendered for the unauthenticated/SSR case. Only the
 * mode-switching state is client-side. */
export function ScheduleForm({ initial, action }: Props) {
  const initialMode: Mode = initial?.mode ?? "always";
  const [mode, setMode] = useState<Mode>(initialMode);

  // Initial values for weekdays mode.
  const wd =
    initial?.mode === "weekdays"
      ? { from: initial.from, to: initial.to }
      : { from: "09:00", to: "17:00" };

  // Initial values for custom mode (per day).
  const initialCustom: Record<DayKey, Window[]> =
    initial?.mode === "custom"
      ? (initial.windows ?? defaultCustomWindows())
      : defaultCustomWindows();
  const [custom, setCustom] = useState<Record<DayKey, Window[]>>(initialCustom);

  // Convenience: toggling a day on/off picks a default window so
  // the user gets visible from/to inputs they can immediately edit.
  const toggleDay = (d: DayKey) => {
    setCustom((prev) => {
      const next = { ...prev };
      if ((prev[d] ?? []).length > 0) {
        next[d] = [];
      } else {
        next[d] = [{ from: "09:00", to: "17:00" }];
      }
      return next;
    });
  };

  const setDayWindow = (d: DayKey, patch: Partial<Window>) => {
    setCustom((prev) => {
      const list = prev[d] ?? [];
      const current = list[0] ?? { from: "09:00", to: "17:00" };
      return { ...prev, [d]: [{ ...current, ...patch }] };
    });
  };

  return (
    <form action={action} className="grid gap-5">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        Schedule mode
      </div>

      <div className="grid gap-2">
        <Radio
          name="mode"
          value="always"
          checked={mode === "always"}
          onChange={() => setMode("always")}
          label="Always on"
          help="Log every drive the moment the toggle is on. Use this if you do business driving any time of day or week."
        />
        <Radio
          name="mode"
          value="weekdays"
          checked={mode === "weekdays"}
          onChange={() => setMode("weekdays")}
          label="Weekdays only"
          help="Mon–Fri inside the window below. Saturdays and Sundays are skipped (battery + privacy)."
        />
        <Radio
          name="mode"
          value="custom"
          checked={mode === "custom"}
          onChange={() => setMode("custom")}
          label="Custom hours"
          help="Pick days + times. Useful if your work hours vary by day."
        />
      </div>

      {mode === "weekdays" ? (
        <div className="card-opaque p-4 rounded-xl grid gap-3">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Weekday window
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-ink-soft">
              From
              <input
                type="time"
                name="weekdays_from"
                defaultValue={wd.from}
                className="mt-1 w-full rounded-lg border border-forest-100 bg-white px-3 py-2 text-sm text-forest-900 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200"
              />
            </label>
            <label className="text-xs text-ink-soft">
              To
              <input
                type="time"
                name="weekdays_to"
                defaultValue={wd.to}
                className="mt-1 w-full rounded-lg border border-forest-100 bg-white px-3 py-2 text-sm text-forest-900 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200"
              />
            </label>
          </div>
        </div>
      ) : null}

      {mode === "custom" ? (
        <div className="card-opaque p-4 rounded-xl grid gap-3">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Custom days + times
          </div>
          <ul className="grid gap-2">
            {DAYS.map((d) => {
              const on = (custom[d] ?? []).length > 0;
              const win = custom[d]?.[0];
              return (
                <li
                  key={d}
                  className="flex items-center gap-3 rounded-xl border border-forest-100 bg-white px-3 py-2"
                >
                  <label className="flex items-center gap-3 min-w-[7.5rem] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      name={`day_${d}`}
                      checked={on}
                      onChange={() => toggleDay(d)}
                      className="size-4 accent-forest-700"
                    />
                    <span className="text-sm font-medium text-forest-900">
                      {DAY_LABEL[d]}
                    </span>
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    <input
                      type="time"
                      name={`from_${d}`}
                      value={win?.from ?? "09:00"}
                      disabled={!on}
                      onChange={(e) =>
                        setDayWindow(d, { from: e.target.value })
                      }
                      className="rounded-lg border border-forest-100 bg-white px-2 py-1 text-sm text-forest-900 disabled:opacity-50 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200"
                    />
                    <span className="text-xs text-ink-muted">to</span>
                    <input
                      type="time"
                      name={`to_${d}`}
                      value={win?.to ?? "17:00"}
                      disabled={!on}
                      onChange={(e) =>
                        setDayWindow(d, { to: e.target.value })
                      }
                      className="rounded-lg border border-forest-100 bg-white px-2 py-1 text-sm text-forest-900 disabled:opacity-50 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button type="submit" className="btn-primary text-sm">
          Save schedule
        </button>
        <p className="text-[11px] text-ink-muted leading-relaxed max-w-xs text-right">
          You can still toggle off manually from the Mileage page.
          The schedule only controls when tracking is allowed to
          auto-resume.
        </p>
      </div>
    </form>
  );
}

function Radio({
  name,
  value,
  checked,
  onChange,
  label,
  help,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  help: string;
}) {
  return (
    <label
      className={
        "flex gap-3 p-4 rounded-xl border cursor-pointer transition-colors " +
        (checked
          ? "border-gold-300 ring-1 ring-gold-200 bg-white"
          : "border-forest-100 bg-white hover:border-gold-300")
      }
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-4 accent-forest-700"
      />
      <div className="min-w-0">
        <div className="display text-base text-forest-900">{label}</div>
        <p className="text-xs text-ink-soft mt-1 leading-relaxed">{help}</p>
      </div>
    </label>
  );
}
