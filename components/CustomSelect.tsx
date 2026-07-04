"use client";

import { useEffect, useRef, useState } from "react";

export type SelectOption = { value: string; label: string };

/**
 * Drop-in replacement for a native `<select>` that submits identically
 * (a hidden input carries the value, so any surrounding
 * `<form action={...}>` server action needs zero changes) but renders
 * its own dropdown entirely in the DOM/CSS, no native
 * AlertDialog/Spinner involved.
 *
 * Why this exists: on at least one real device (Samsung Galaxy Z
 * Fold5, confirmed via `uiautomator dump` + a deliberate drawable
 * swap), the native `<select>` popup rendered the app's launch splash
 * drawable behind its option rows, traced to Android's own
 * "starting window" preview snapshot (keyed off the manifest's static
 * splash theme, unaffected by any runtime theme/window changes) most
 * likely combined with a foldable-specific oversized list-row quirk.
 * Both are OS/OEM behaviors outside the app's theming control, so
 * this sidesteps the native control entirely instead of chasing it.
 */
export function CustomSelect({
  name,
  options,
  defaultValue,
  className = "input",
  placeholder,
}: {
  name: string;
  options: SelectOption[];
  defaultValue?: string;
  className?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    // min-w-0: this is typically a grid/flex item; without it, the
    // truncated (white-space: nowrap) label below can force this whole
    // element, and its parent grid track, wider than the viewport on
    // mobile instead of actually truncating.
    <div ref={rootRef} className="relative min-w-0">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          className +
          " flex items-center justify-between gap-2 text-left cursor-pointer"
        }
      >
        <span
          className={
            "min-w-0 truncate " + (selected ? "" : "text-ink-muted")
          }
        >
          {selected?.label ?? placeholder ?? "Select…"}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={
            "shrink-0 text-ink-muted transition-transform " +
            (open ? "rotate-180" : "")
          }
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 7.5l5 5 5-5" />
        </svg>
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-forest-200 bg-white py-1 shadow-lg"
        >
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  setValue(o.value);
                  setOpen(false);
                }}
                className={
                  "w-full px-3 py-2 text-left text-sm hover:bg-cream/60 " +
                  (o.value === value
                    ? "bg-cream/80 font-medium text-forest-900"
                    : "text-ink-soft")
                }
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
