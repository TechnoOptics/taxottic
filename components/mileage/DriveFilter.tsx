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
  loadingOlder = false,
  olderError = null,
}: {
  drives: { started_at: string }[];
  onChange: (key: FilterKey) => void;
  onLoadOlder?: () => void;
  /** A load is in flight. The control says so and refuses a second tap,
   *  because a control that looks idle while it works is the exact thing
   *  this task removed. */
  loadingOlder?: boolean;
  /** The last load failed, in words the driver can act on. Silence here
   *  is indistinguishable from a dead control. */
  olderError?: string | null;
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
        <div className="grid gap-1">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            aria-busy={loadingOlder}
            className="mono-label min-h-11 inline-flex items-center text-left disabled:opacity-60"
          >
            {loadingOlder
              ? "Loading older drives."
              : "Older drives are not loaded yet. Load more."}
          </button>
          {olderError ? (
            // Announced, not just drawn. A driver who taps and gets
            // nothing has no way to tell a failure from the dead control
            // this whole change existed to remove, so the failure has to
            // say so out loud.
            <p role="status" className="mono-label text-[var(--muted)]">
              {olderError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
