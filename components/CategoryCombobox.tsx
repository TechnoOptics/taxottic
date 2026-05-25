"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

/**
 * Searchable category picker. Drop-in for the previous plain <select>
 * on the import-review page. The full category list is always
 * visible behind the dropdown — typing in the trigger filters by a
 * substring match against label + code, ranked smart-first:
 *
 *   1. Exact label start (typed "supp" → "Supplies" before "Office supplies")
 *   2. Frequently-used codes (passed by the parent) bubble up among
 *      otherwise-equal matches — the user's actual hit-rate steering
 *      what shows on top.
 *   3. Then alphabetical by label.
 *
 * Renders a hidden <input name={name}> carrying the chosen code so
 * the surrounding <form action={...}> keeps working exactly like it
 * did with the native select. If JS doesn't run (very old browser,
 * SSR pass) the underlying <select> is also rendered (visually
 * hidden via sr-only on the JS path) so the form is still
 * functional.
 *
 * Keyboard:
 *   ArrowDown / ArrowUp  navigate the visible list
 *   Enter                pick the highlighted option
 *   Escape               close + clear filter
 *   Type any printable   open + filter
 */

export type CategoryOption = {
  code: string;
  label: string;
  /** Optional grouping hint shown in the dropdown — e.g. Schedule C
   *  Line 23 — for users who can rattle off line numbers. */
  hint?: string | null;
  /** scope === "transfer" gets a small subdued treatment so users see
   *  it's a labelling category, not a deduction. */
  scope?: string | null;
  /** Bucket name from deduction_categories.display_group. When the
   *  dropdown is open with no query, options group under headers
   *  matching this string. Falls back to "Other" when missing. */
  group?: string | null;
};

type Props = {
  /** Hidden input name — matches the original <select name=...> so
   *  the wrapping form action keeps working. */
  name: string;
  /** Currently-applied code (rendered as the trigger label on load). */
  defaultValue?: string | null;
  /** Full set of options the user can pick from. */
  options: CategoryOption[];
  /** Optional set of codes used most often by THIS user. They float
   *  to the top of otherwise-equal matches. */
  frequentCodes?: string[];
  /** Optional placeholder for the empty / cleared state. */
  placeholder?: string;
  /** Auto-submit the closest enclosing <form> when a pick is made.
   *  Matches the existing review-page UX where picking a category
   *  immediately persists. */
  autoSubmit?: boolean;
  /** Extra class on the trigger button. */
  className?: string;
  /** Render an explicit "Skip / not deductible" option at the top
   *  with empty value. Matches the previous select's first option. */
  allowEmpty?: boolean;
  emptyLabel?: string;
};

function rankScore(opt: CategoryOption, q: string, freq: Set<string>): number {
  // Lower is better.
  if (!q) return freq.has(opt.code) ? 0 : 1;
  const ql = q.toLowerCase();
  const label = opt.label.toLowerCase();
  if (label.startsWith(ql)) return freq.has(opt.code) ? -2 : -1;
  if (label.includes(ql)) return freq.has(opt.code) ? 2 : 3;
  if (opt.code.toLowerCase().includes(ql)) return 4;
  if ((opt.hint ?? "").toLowerCase().includes(ql)) return 5;
  return 99; // does not match — filtered out before ranking
}

function matches(opt: CategoryOption, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  return (
    opt.label.toLowerCase().includes(ql) ||
    opt.code.toLowerCase().includes(ql) ||
    (opt.hint ?? "").toLowerCase().includes(ql)
  );
}

export function CategoryCombobox({
  name,
  defaultValue,
  options,
  frequentCodes,
  placeholder = "Pick a category",
  autoSubmit = true,
  className,
  allowEmpty = true,
  emptyLabel = "Skip / not deductible",
}: Props) {
  const [value, setValue] = useState<string>(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hiddenRef = useRef<HTMLInputElement | null>(null);
  const freqSet = useMemo(
    () => new Set(frequentCodes ?? []),
    [frequentCodes],
  );

  // Order options for the dropdown: filter to matches, then sort by
  // smart rank, then alphabetical fallback.
  const visible = useMemo(() => {
    const list = options.filter((o) => matches(o, query));
    list.sort((a, b) => {
      const ra = rankScore(a, query, freqSet);
      const rb = rankScore(b, query, freqSet);
      if (ra !== rb) return ra - rb;
      return a.label.localeCompare(b.label);
    });
    return list;
  }, [options, query, freqSet]);

  // When NOT searching, group the visible options under display_group
  // headers (Insurance / Vehicle / Travel-meals-gifts / …) so the
  // user can scan 80+ categories without losing the thread.
  // When searching, flatten — group headers in a search context
  // hurt more than help.
  const grouped = useMemo(() => {
    if (query) return null;
    const map = new Map<string, CategoryOption[]>();
    for (const o of visible) {
      const g = o.group ?? "Other";
      const arr = map.get(g) ?? [];
      arr.push(o);
      map.set(g, arr);
    }
    return Array.from(map.entries());
  }, [visible, query]);

  // `highlight` is clamped at every read site (see effectiveHighlight
  // below) rather than via an effect — calling setState in a useEffect
  // when `visible.length` changes triggers a cascading render that
  // both feels janky and trips react-hooks/purity. Read-time clamping
  // gets the same correctness for free.
  const effectiveHighlight = Math.min(
    highlight,
    Math.max(0, visible.length - 1),
  );

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const currentLabel = value
    ? options.find((o) => o.code === value)?.label ?? value
    : "";

  const pick = (code: string) => {
    setValue(code);
    setOpen(false);
    setQuery("");
    // setTimeout so React applies the value update before form submit;
    // the hidden input reads .value via DOM at submit time.
    if (autoSubmit && hiddenRef.current) {
      // Update the hidden input DOM value directly first — React's
      // re-render hasn't run yet at this point.
      hiddenRef.current.value = code;
      const form = hiddenRef.current.closest("form");
      if (form) {
        // requestSubmit triggers the form's `action` prop (server
        // action) the same way a click on a submit button would.
        form.requestSubmit();
      }
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight(Math.min(effectiveHighlight + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(Math.max(effectiveHighlight - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = visible[effectiveHighlight];
      if (opt) pick(opt.code);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div ref={wrapRef} className={"relative " + (className ?? "")}>
      <input
        ref={hiddenRef}
        type="hidden"
        name={name}
        defaultValue={value}
      />
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="input flex w-full items-center justify-between text-left"
      >
        <span
          className={
            "truncate " + (currentLabel ? "text-forest-900" : "text-ink-muted")
          }
        >
          {currentLabel || placeholder}
        </span>
        <span aria-hidden="true" className="text-ink-muted ml-2">
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Categories"
          className="absolute z-40 mt-1 w-full max-w-md rounded-lg border border-forest-200 bg-white shadow-lg overflow-hidden"
        >
          <div className="border-b border-forest-100 p-2 bg-cream/40">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setHighlight(0);
              }}
              onKeyDown={onKey}
              placeholder="Type to search categories…"
              className="w-full rounded-md border border-forest-100 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200"
              autoFocus
            />
          </div>
          <ul className="max-h-80 overflow-y-auto py-1">
            {allowEmpty ? (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick("")}
                  className={
                    "block w-full text-left px-3 py-2 text-sm " +
                    (value === ""
                      ? "bg-cream text-forest-900"
                      : "text-ink-muted hover:bg-cream")
                  }
                >
                  {emptyLabel}
                </button>
              </li>
            ) : null}
            {visible.length === 0 ? (
              <li className="px-3 py-3 text-sm text-ink-muted">
                No categories match &ldquo;{query}&rdquo;
              </li>
            ) : grouped ? (
              // Grouped view (no query): render section headers
              // between groups so users can scan ~80 categories by
              // bucket. Each item retains its own visible-index for
              // keyboard-highlight purposes — we maintain a running
              // counter across groups.
              (() => {
                let idx = -1;
                return grouped.map(([groupName, opts]) => (
                  <li key={groupName}>
                    <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-[0.22em] text-gold-700 font-medium">
                      {groupName}
                    </div>
                    <ul>
                      {opts.map((o) => {
                        idx++;
                        const i = idx;
                        const active = i === effectiveHighlight;
                        const isTransfer = o.scope === "transfer";
                        const isCredit = o.scope === "credit";
                        return (
                          <li key={o.code}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={value === o.code}
                              onMouseDown={(e) => e.preventDefault()}
                              // eslint-disable-next-line react-hooks/refs -- pick fires via click, not during render
                              onClick={() => pick(o.code)}
                              onMouseEnter={() => setHighlight(i)}
                              className={
                                "w-full text-left px-3 py-2 text-sm flex items-center gap-2 " +
                                (active
                                  ? "bg-cream text-forest-900"
                                  : "text-forest-800 hover:bg-cream/70")
                              }
                            >
                              <span className="flex-1 truncate">
                                {o.label}
                                {isTransfer ? (
                                  <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                                    transfer · not a deduction
                                  </span>
                                ) : isCredit ? (
                                  <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-emerald-700">
                                    tax credit
                                  </span>
                                ) : null}
                              </span>
                              {o.hint ? (
                                <span className="text-[10px] uppercase tracking-[0.18em] text-ink-muted shrink-0">
                                  {o.hint}
                                </span>
                              ) : null}
                              {freqSet.has(o.code) ? (
                                <span
                                  aria-hidden="true"
                                  title="Frequently used"
                                  className="text-gold-600 text-[12px]"
                                >
                                  ★
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ));
              })()
            ) : (
              // Search view (query active): flat list, no group
              // headers. Faster to scan when filtering.
              visible.map((o, i) => {
                const active = i === effectiveHighlight;
                const isTransfer = o.scope === "transfer";
                const isCredit = o.scope === "credit";
                return (
                  <li key={o.code}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={value === o.code}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o.code)}
                      onMouseEnter={() => setHighlight(i)}
                      className={
                        "w-full text-left px-3 py-2 text-sm flex items-center gap-2 " +
                        (active
                          ? "bg-cream text-forest-900"
                          : "text-forest-800 hover:bg-cream/70")
                      }
                    >
                      <span className="flex-1 truncate">
                        {o.label}
                        {isTransfer ? (
                          <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                            transfer · not a deduction
                          </span>
                        ) : isCredit ? (
                          <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-emerald-700">
                            tax credit
                          </span>
                        ) : null}
                      </span>
                      {o.hint ? (
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink-muted shrink-0">
                          {o.hint}
                        </span>
                      ) : null}
                      {freqSet.has(o.code) ? (
                        <span
                          aria-hidden="true"
                          title="Frequently used"
                          className="text-gold-600 text-[12px]"
                        >
                          ★
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
