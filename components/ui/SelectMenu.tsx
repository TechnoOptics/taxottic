"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * On-brand dropdown that renders ENTIRELY in the DOM — no native
 * <select> popup. Native selects on Android WebViews (Capacitor) paint
 * their dropdown popup solid black in dark mode, blanking the screen
 * (reproduced on a Galaxy Z Fold5). A global `color-scheme: light`
 * makes them merely functional; this component makes every dropdown a
 * crisp, consistent in-app menu.
 *
 * Drop-in for the two real-world shapes in this codebase:
 *   1. UNCONTROLLED form field — pass `name` + `defaultValue`. A hidden
 *      <input name=...> carries the value so it submits with the form
 *      exactly like the old <select> did.
 *   2. CONTROLLED — pass `value` + `onValueChange`.
 *
 * onValueChange fires after a pick; the hidden input is updated
 * synchronously first, so an `e.currentTarget.form?.requestSubmit()` in
 * the handler (the auto-submit pattern) sees the new value immediately.
 */
export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function SelectMenu({
  name,
  options,
  defaultValue,
  value,
  onValueChange,
  placeholder = "Select…",
  disabled = false,
  required = false,
  className = "",
  buttonClassName = "",
  ariaLabel,
  id,
}: {
  name?: string;
  options: SelectOption[];
  defaultValue?: string;
  /** Controlled value. When provided the component is controlled. */
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Wrapper className (positioning). */
  className?: string;
  /** Override the trigger button styling (defaults to the `.input` look). */
  buttonClassName?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const current = isControlled ? (value as string) : internal;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hiddenRef = useRef<HTMLInputElement | null>(null);
  const autoId = useId();
  const btnId = id ?? `sm-${autoId}`;

  const selected = options.find((o) => o.value === current);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (v: string) => {
    // Sync the hidden input immediately so a form.requestSubmit() inside
    // onValueChange reads the new value before React re-renders.
    if (hiddenRef.current) hiddenRef.current.value = v;
    if (!isControlled) setInternal(v);
    setOpen(false);
    onValueChange?.(v);
  };

  return (
    <div ref={rootRef} className={"relative " + className}>
      {name ? (
        <input
          ref={hiddenRef}
          type="hidden"
          name={name}
          value={current}
          required={required}
          readOnly
        />
      ) : null}
      <button
        type="button"
        id={btnId}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
        className={
          (buttonClassName ||
            "input w-full flex items-center justify-between gap-2 text-left") +
          " disabled:opacity-60 " +
          (disabled ? "cursor-not-allowed" : "cursor-pointer")
        }
      >
        <span
          className={
            "truncate " + (selected ? "text-forest-900" : "text-ink-muted")
          }
        >
          {selected ? selected.label : placeholder}
        </span>
        <svg
          viewBox="0 0 20 20"
          className={
            "size-4 shrink-0 text-ink-muted transition-transform " +
            (open ? "rotate-180" : "")
          }
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 8l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-labelledby={btnId}
          className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-auto rounded-xl border border-forest-200 bg-white py-1 shadow-xl"
        >
          {options.map((o) => {
            const active = o.value === current;
            return (
              <li key={o.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  disabled={o.disabled}
                  onClick={() => choose(o.value)}
                  className={
                    "w-full text-left px-3 py-2.5 text-sm flex items-center justify-between gap-2 disabled:opacity-50 " +
                    (active
                      ? "bg-forest-50 text-forest-900 font-medium"
                      : "text-forest-800 hover:bg-cream")
                  }
                >
                  <span className="truncate">{o.label}</span>
                  {active ? (
                    <svg
                      viewBox="0 0 16 16"
                      className="size-3.5 shrink-0 text-emerald-600"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 8l4 4 6-8" />
                    </svg>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
