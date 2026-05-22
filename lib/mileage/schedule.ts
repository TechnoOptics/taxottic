// Mileage tracking schedule — when the auto-track service should be
// allowed to run. The user picks a high-level mode ("always" /
// "weekdays" / "custom") on /mileage/schedule and we persist it on
// profiles.mileage_schedule as JSONB.
//
// `null` (the default) means "no constraint": the toggle, when on,
// runs continuously. That preserves the existing behaviour for users
// who don't visit the schedule page.

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_LABEL: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export type Window = {
  /** 24-hour clock, "HH:MM". */
  from: string;
  /** Exclusive end, "HH:MM". "from" < "to". For overnight (rare) use
   *  two windows on adjacent days. */
  to: string;
};

export type MileageSchedule =
  | { mode: "always" }
  | { mode: "weekdays"; from: string; to: string }
  | { mode: "custom"; windows: Record<DayKey, Window[]> };

/** Default to "always" when the user hasn't picked a schedule yet
 *  but has visited the schedule page. Tracker treats null as
 *  "always on" anyway, but pickling this explicitly lets the UI
 *  light up the right radio button when the user re-opens it. */
export const DEFAULT_SCHEDULE: MileageSchedule = { mode: "always" };

/** The "Weekdays 9-5" quick preset, applied when the user picks
 *  the weekdays preset. UI lets them tweak the from/to. */
export const WEEKDAYS_PRESET: MileageSchedule = {
  mode: "weekdays",
  from: "09:00",
  to: "17:00",
};

/** Custom mode: enable every weekday 9-5, weekends empty. The user
 *  edits from there. */
export function defaultCustomWindows(): Record<DayKey, Window[]> {
  return {
    mon: [{ from: "09:00", to: "17:00" }],
    tue: [{ from: "09:00", to: "17:00" }],
    wed: [{ from: "09:00", to: "17:00" }],
    thu: [{ from: "09:00", to: "17:00" }],
    fri: [{ from: "09:00", to: "17:00" }],
    sat: [],
    sun: [],
  };
}

/** Day-of-week for the current moment in the user's local time.
 *  Returns a key matching DayKey. */
export function dayKeyFor(now: Date): DayKey {
  const idx = now.getDay(); // 0 = Sun … 6 = Sat
  return DAYS[(idx + 6) % 7];
}

/** Parse "HH:MM" → minutes-since-midnight. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Should auto-tracking be active right now per this schedule?
 *  - null / always       → true
 *  - weekdays            → true Mon-Fri inside [from, to)
 *  - custom              → true if any window for today contains now
 *  Open-ended on parsing failures: returns true so a broken schedule
 *  never silently disables tracking. The UI is responsible for
 *  validating before save. */
export function isActiveNow(
  schedule: MileageSchedule | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!schedule || schedule.mode === "always") return true;
  const day = dayKeyFor(now);
  const minutes = now.getHours() * 60 + now.getMinutes();

  if (schedule.mode === "weekdays") {
    const isWeekday = day !== "sat" && day !== "sun";
    if (!isWeekday) return false;
    const from = toMinutes(schedule.from);
    const to = toMinutes(schedule.to);
    if (from == null || to == null) return true; // fail-open
    return minutes >= from && minutes < to;
  }

  if (schedule.mode === "custom") {
    const windows = schedule.windows?.[day] ?? [];
    for (const w of windows) {
      const from = toMinutes(w.from);
      const to = toMinutes(w.to);
      if (from == null || to == null) continue;
      if (minutes >= from && minutes < to) return true;
    }
    return false;
  }

  return true;
}

/** Friendly summary line for a saved schedule. Shown under the
 *  auto-track toggle once a schedule is saved. */
export function summarise(
  schedule: MileageSchedule | null | undefined,
): string {
  if (!schedule || schedule.mode === "always") return "Always on";
  if (schedule.mode === "weekdays") {
    return `Weekdays · ${schedule.from} – ${schedule.to}`;
  }
  const activeDays = DAYS.filter((d) => (schedule.windows?.[d] ?? []).length > 0);
  if (activeDays.length === 0) return "Off (no windows set)";
  if (activeDays.length === 7) return "Every day · custom hours";
  return `${activeDays.map((d) => DAY_LABEL[d].slice(0, 3)).join(", ")} · custom hours`;
}
