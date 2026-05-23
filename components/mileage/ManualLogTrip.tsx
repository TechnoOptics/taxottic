"use client";

import { useState } from "react";

/**
 * Manual drive entry — the backfill path when the tracker missed
 * a drive (app killed, schedule blocked, GPS denied, etc). GPS
 * background capture is best-effort on Android; without a manual
 * entry the user just loses the deduction, which is the wrong
 * outcome.
 *
 * Renders as a collapsed card by default so it doesn't dominate the
 * page; opens to a small form with datetime-locals + miles +
 * classification radio. Submits to the addManualTrip server action.
 *
 * The browser sends its current timezone offset alongside the form
 * fields so the server can reconstruct the UTC instant correctly
 * from the naive `datetime-local` value. (See actions.ts for the
 * detailed comment on why this is needed.)
 */
type Props = {
  action: (formData: FormData) => Promise<void>;
};

function defaultDatetimeLocal(d: Date) {
  // YYYY-MM-DDTHH:MM in local time — the datetime-local input wants
  // exactly this shape and no timezone suffix.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ManualLogTrip({ action }: Props) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const aHourAgo = new Date(now.getTime() - 60 * 60_000);
  const defaultStart = defaultDatetimeLocal(aHourAgo);
  const defaultEnd = defaultDatetimeLocal(now);

  const handleSubmit = async (formData: FormData) => {
    setSubmitting(true);
    setError(null);
    // The form's datetime-local inputs are naive — attach the
    // browser's current offset so the server can convert to UTC.
    formData.set("tz_offset_min", String(now.getTimezoneOffset()));
    try {
      await action(formData);
      setOpen(false);
    } catch (err) {
      setError((err as Error)?.message ?? "Couldn't save.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 text-xs text-forest-700 hover:text-forest-900 underline underline-offset-2"
        >
          <span aria-hidden="true">＋</span>
          Missed a drive? Log it manually
        </button>
      </div>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="mt-3 card p-4 grid gap-3"
      aria-label="Manually log a drive"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="display text-base text-forest-900">
          Log a drive manually
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-muted hover:text-forest-900"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-ink-muted leading-relaxed">
        Use this when the tracker missed a drive (app killed,
        permissions blocked, etc). Counts the same toward your
        deduction as a tracker-logged trip.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="grid gap-1 text-xs text-forest-800">
          Start
          <input
            type="datetime-local"
            name="started_at_local"
            defaultValue={defaultStart}
            required
            className="rounded-md border border-forest-200 px-3 h-10 text-sm bg-white"
          />
        </label>
        <label className="grid gap-1 text-xs text-forest-800">
          End
          <input
            type="datetime-local"
            name="ended_at_local"
            defaultValue={defaultEnd}
            required
            className="rounded-md border border-forest-200 px-3 h-10 text-sm bg-white"
          />
        </label>
      </div>

      <label className="grid gap-1 text-xs text-forest-800">
        Miles
        <input
          type="number"
          name="distance_miles"
          step="0.1"
          min="0.1"
          max="9999"
          required
          placeholder="e.g. 12.4"
          className="rounded-md border border-forest-200 px-3 h-10 text-sm bg-white"
        />
      </label>

      <fieldset className="grid gap-2">
        <legend className="text-xs text-forest-800">Classification</legend>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { v: "business", label: "Business" },
              { v: "personal", label: "Personal" },
              { v: "unclassified", label: "Review later" },
            ] as const
          ).map((opt, i) => (
            <label
              key={opt.v}
              className="text-xs text-forest-800 cursor-pointer rounded-md border border-forest-200 px-2 h-10 grid place-items-center has-checked:bg-forest-900 has-checked:text-cream has-checked:border-forest-900 transition-colors"
            >
              <input
                type="radio"
                name="classification"
                value={opt.v}
                defaultChecked={i === 0}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-forest-900 text-cream h-10 text-sm font-medium disabled:opacity-60"
      >
        {submitting ? "Saving…" : "Log drive"}
      </button>
    </form>
  );
}
