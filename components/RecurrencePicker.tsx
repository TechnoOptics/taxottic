"use client";

import { useEffect, useState } from "react";

/**
 * Two-stage recurrence input:
 *   1. Toggle: One-off vs. Recurring
 *   2. If Recurring, pick a cadence (weekly / monthly / quarterly / annual)
 *
 * The parent submits a single hidden `recurrence` field with the resolved
 * value (`one_off` if the toggle is off; the cadence value if it's on).
 *
 * The `signal` prop lets the expense form push a "this category is
 * typically recurring" hint when the user picks rent / a subscription /
 * etc. We honour the hint only if the user hasn't manually overridden the
 * toggle yet, so we don't undo a deliberate choice.
 */
export function RecurrencePicker({
  defaultValue = "one_off",
  // When this string changes, snap to recurring/monthly unless the user
  // has already touched the toggle. The parent component changes this
  // value (e.g., the chosen category code) when it wants us to react.
  signal,
  signalSuggestsRecurring = false,
}: {
  defaultValue?: Cadence;
  signal?: string;
  signalSuggestsRecurring?: boolean;
}) {
  const [recurring, setRecurring] = useState<boolean>(
    defaultValue !== "one_off",
  );
  const [cadence, setCadence] = useState<Cadence>(
    defaultValue !== "one_off" ? defaultValue : "monthly",
  );
  const [touched, setTouched] = useState<boolean>(false);

  // React to category-driven hints, but only if the user hasn't manually
  // toggled. Once they touch the radio, we leave them alone.
  useEffect(() => {
    if (touched) return;
    if (signalSuggestsRecurring) {
      setRecurring(true);
      setCadence("monthly");
    } else {
      setRecurring(false);
    }
    // We deliberately depend on signal so a category change re-evaluates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal, signalSuggestsRecurring]);

  const resolved: Cadence = recurring ? cadence : "one_off";

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium text-forest-800">Frequency</span>
      <input type="hidden" name="recurrence" value={resolved} />
      <div
        role="radiogroup"
        aria-label="Frequency"
        className="grid grid-cols-2 gap-2"
      >
        <Pill
          checked={!recurring}
          onClick={() => {
            setRecurring(false);
            setTouched(true);
          }}
          label="One-off"
          sub="A single event"
        />
        <Pill
          checked={recurring}
          onClick={() => {
            setRecurring(true);
            setTouched(true);
          }}
          label="Recurring"
          sub="Same amount on a cadence"
        />
      </div>
      {recurring ? (
        <label className="grid gap-1.5 mt-1">
          <span className="text-xs text-ink-muted">Cadence</span>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as Cadence)}
            className="input"
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annually</option>
          </select>
          <span className="text-[11px] text-ink-muted leading-relaxed">
            Enter the amount paid <strong>each period</strong>. We&apos;ll
            extrapolate it to year-end automatically.
          </span>
        </label>
      ) : null}
    </div>
  );
}

function Pill({
  checked,
  onClick,
  label,
  sub,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={
        "rounded-xl border px-3 py-2.5 text-left transition-colors " +
        (checked
          ? "border-forest-800 bg-forest-800 text-cream"
          : "border-forest-100 bg-white/70 text-forest-900 hover:border-forest-300")
      }
    >
      <div className="text-sm font-medium">{label}</div>
      <div
        className={
          "text-[11px] " + (checked ? "text-cream/75" : "text-ink-muted")
        }
      >
        {sub}
      </div>
    </button>
  );
}

export type Cadence =
  | "one_off"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual";
