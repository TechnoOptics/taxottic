"use client";

import { useMemo, useState } from "react";
import { groupByCategory, searchDeductions } from "@/lib/deductions/applicability";
import type { MasterDeduction } from "@/lib/deductions/types";

type Props = {
  deductions: readonly MasterDeduction[];
  totalCount: number;
};

export function DeductionExplorer({ deductions, totalCount }: Props) {
  const [query, setQuery] = useState("");
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => searchDeductions(deductions, query),
    [deductions, query],
  );

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);

  // When the user is searching, auto-open every category that has matches so
  // they don't have to expand each one to see the hits. When the search is
  // empty we respect the user's manual open/close.
  const isSearching = query.trim().length > 0;

  function toggleCategory(name: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="mt-8">
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-xl">
          <input
            type="search"
            placeholder="Search deductions, categories, or notes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input pr-9"
            aria-label="Search deductions"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 size-7 rounded text-ink-muted hover:text-forest-700 hover:bg-forest-50 inline-flex items-center justify-center"
            >
              ×
            </button>
          ) : null}
        </div>
        <div className="text-xs text-ink-muted shrink-0">
          {filtered.length.toLocaleString()} of {totalCount.toLocaleString()}{" "}
          deductions {isSearching ? "match" : "shown"}
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="mt-10 card p-8 text-center">
          <div className="display text-lg text-forest-900">No matches</div>
          <p className="mt-2 text-sm text-ink-soft">
            Try a broader term — &ldquo;software,&rdquo; &ldquo;travel,&rdquo;
            &ldquo;home office,&rdquo; or a specific merchant name.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-2">
          {grouped.map(({ category, items }) => {
            const isOpen = isSearching || openCategories.has(category);
            return (
              <li
                key={category}
                className="card overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleCategory(category)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-forest-50/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="display text-base sm:text-lg text-forest-900 truncate">
                      {category}
                    </div>
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      {items.length} deduction{items.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <span
                    aria-hidden="true"
                    className={
                      "shrink-0 size-7 rounded-full bg-forest-50 inline-flex items-center justify-center text-forest-700 transition-transform duration-200 " +
                      (isOpen ? "rotate-180" : "")
                    }
                  >
                    ▾
                  </span>
                </button>
                {isOpen ? (
                  <ul className="border-t border-forest-100 divide-y divide-forest-100">
                    {items.map((d) => (
                      <li key={d.code} className="px-5 py-3">
                        <DeductionRow deduction={d} highlight={query} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DeductionRow({
  deduction,
  highlight,
}: {
  deduction: MasterDeduction;
  highlight: string;
}) {
  return (
    <div className="grid sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-start">
      <div className="min-w-0">
        <div className="text-sm sm:text-base text-forest-900 font-medium">
          {hl(deduction.name, highlight)}
        </div>
        <div className="text-xs text-ink-muted mt-1 leading-relaxed">
          {hl(deduction.notes, highlight)}
        </div>
        {deduction.industry ? (
          <div className="mt-1.5 text-[11px] text-forest-700">
            <span className="text-gold-700 uppercase tracking-wider mr-1">
              Best fit:
            </span>
            {deduction.industry}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col sm:items-end gap-1 shrink-0">
        <span className="text-[10px] uppercase tracking-[0.18em] text-forest-700 px-2 py-0.5 rounded-full bg-forest-50 border border-forest-100">
          {deduction.code}
        </span>
        {deduction.source ? (
          <a
            href={deduction.source}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-forest-700 hover:text-forest-900 underline underline-offset-2"
          >
            IRS source ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

// Highlight matches inside a string using a <mark>; safe because we only
// emit text nodes between matches.
function hl(text: string, q: string) {
  const query = q.trim();
  if (!query) return text;
  const re = new RegExp(`(${escapeRegExp(query)})`, "ig");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) ? (
          <mark
            key={i}
            className="bg-gold-100 text-forest-900 rounded px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
