"use client";

import { useState } from "react";
import {
  coversWindow,
  FILTER_LABELS,
  type FilterKey,
} from "@/lib/mileage/drive-filter";

const KEYS: FilterKey[] = ["all", "week", "month", "quarter"];

/**
 * The range control, which used to be four Links to ?range= on a
 * force-dynamic page. A tap started a full server render and nothing on
 * screen changed until it came back, which read as a dead control. It
 * filters loaded drives now, so it answers on the tap.
 */
export function DriveFilter({
  drives,
  onChange,
  onLoadOlder,
}: {
  drives: { started_at: string }[];
  onChange: (key: FilterKey) => void;
  onLoadOlder?: () => void;
}) {
  /**
   * The chosen window, and the instant it was chosen at.
   *
   * The clock is read in the tap handler, not during render. A render is
   * not an event: re-reading Date.now() on every one lets an unrelated
   * re-render move the window boundary under a list the driver is
   * looking at, and React's rules-of-hooks lint says the same thing
   * about calling an impure function while rendering. "All" spans every
   * instant, so the initial value needs no clock read at all.
   */
  const [picked, setPicked] = useState<{ key: FilterKey; at: number }>({
    key: "all",
    at: 0,
  });
  const key = picked.key;
  const short = !coversWindow(drives, key, picked.at);
  return (
    <div className="grid gap-2">
      <div role="group" aria-label="Filter drives" className="flex flex-wrap gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={k === key}
            onClick={() => {
              setPicked({ key: k, at: Date.now() });
              onChange(k);
            }}
            className={
              "min-h-11 px-3 inline-flex items-center border text-sm " +
              (k === key
                ? "border-[var(--foreground)] text-[var(--foreground)]"
                : "border-edge text-[var(--muted)]")
            }
          >
            {FILTER_LABELS[k]}
          </button>
        ))}
      </div>
      {short && onLoadOlder ? (
        <button
          type="button"
          onClick={onLoadOlder}
          className="mono-label min-h-11 inline-flex items-center text-left"
        >
          Older drives are not loaded yet. Load more.
        </button>
      ) : null}
    </div>
  );
}
