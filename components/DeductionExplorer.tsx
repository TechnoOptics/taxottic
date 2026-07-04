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
            Try a broader term - &ldquo;software,&rdquo; &ldquo;travel,&rdquo;
            &ldquo;home office,&rdquo; or a specific merchant name.
          </p>
        </div>
      ) : (
        // Two INDEPENDENT column stacks on lg+, NOT a CSS grid. A grid forces
        // both columns to share row heights, so expanding one category left a
        // ~5,700px blank gap beside its collapsed neighbour and shoved every
        // later row down. Splitting the categories into two self-contained
        // vertical stacks means opening a category only pushes items DOWN ITS
        // OWN column; the other side never moves. Half-split (first half left,
        // second half right) so the columns still read in natural order when
        // they stack into one column on mobile.
        (() => {
          const renderCategory = ({
            category,
            items,
          }: (typeof grouped)[number]) => {
            const isOpen = isSearching || openCategories.has(category);
            return (
              <li key={category} className="card overflow-hidden">
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
          };
          const mid = Math.ceil(grouped.length / 2);
          const columns = [grouped.slice(0, mid), grouped.slice(mid)];
          return (
            <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-start">
              {columns.map((col, ci) => (
                <ul key={ci} className="flex min-w-0 flex-1 flex-col gap-3">
                  {col.map(renderCategory)}
                </ul>
              ))}
            </div>
          );
        })()
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
  // The IRS publication / form the source URL points at, the "which tax
  // reference applies" answer, surfaced as a chip on wide screens.
  const ref = irsRef(deduction.source);
  return (
    // On lg+ a third middle column carries the tax details so the wide row's
    // dead centre space is used for something useful (reference + who it
    // applies to) instead of blank canvas. Below lg it collapses to the
    // original compact two-column layout.
    <div className="grid items-start gap-2 sm:gap-4 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]">
      {/* Description */}
      <div className="min-w-0">
        <div className="text-sm sm:text-base text-forest-900 font-medium">
          {hl(deduction.name, highlight)}
        </div>
        <div className="text-xs text-ink-muted mt-1 leading-relaxed">
          {hl(deduction.notes, highlight)}
        </div>
        {/* Best-fit rides under the description on small/medium; on lg it
            moves into the dedicated details column (below). */}
        {deduction.industry ? (
          <div className="mt-1.5 text-[11px] text-forest-700 lg:hidden">
            <span className="text-gold-700 uppercase tracking-wider mr-1">
              Best fit:
            </span>
            {deduction.industry}
          </div>
        ) : null}
      </div>

      {/* Tax details, fills the wide-screen blank space. Hidden below lg. */}
      <div className="hidden min-w-0 text-[11px] leading-relaxed lg:flex lg:flex-col lg:gap-1.5">
        {ref ? (
          <div>
            <span className="text-gold-700 uppercase tracking-wider mr-1">
              Tax reference
            </span>
            <span className="font-medium text-forest-800">{ref}</span>
          </div>
        ) : null}
        {deduction.applicability ? (
          <div className="text-ink-soft">
            <span className="text-gold-700 uppercase tracking-wider mr-1">
              Applies to
            </span>
            {hl(deduction.applicability, highlight)}
          </div>
        ) : null}
        {deduction.industry ? (
          <div className="text-forest-700">
            <span className="text-gold-700 uppercase tracking-wider mr-1">
              Best fit
            </span>
            {deduction.industry}
          </div>
        ) : null}
      </div>

      {/* Code + IRS source */}
      <div className="flex flex-col sm:items-end gap-1 shrink-0">
        <span className="text-[10px] uppercase tracking-[0.18em] text-forest-700 px-2 py-0.5 rounded-full bg-forest-50 border border-forest-100">
          {deduction.code}
        </span>
        {deduction.source ? (
          <a
            href={deduction.source}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
          >
            IRS source ↗
          </a>
        ) : null}
        {/* On narrow screens the tax reference has nowhere else to live. */}
        {ref ? (
          <span className="text-[10px] text-ink-muted lg:hidden">{ref}</span>
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

// Turn an IRS source URL into a short, human "which reference applies" label,
// e.g. .../publications/p15b -> "IRS Pub 15-B", /instructions/i7206 ->
// "IRS Instr. 7206", a Schedule C link -> "Schedule C". Falls back to a
// generic label so the chip is always meaningful. Pure string parsing, no
// network, matches the catalog's known irs.gov URL shapes.
function irsRef(url: string): string | null {
  if (!url) return null;
  const u = url.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = u.match(/\/p(\d+)([a-z]?)(?:\.pdf)?(?:[/?#]|$)/))) {
    return `IRS Pub ${m[1]}${m[2] ? "-" + m[2].toUpperCase() : ""}`;
  }
  if ((m = u.match(/\/i(\d+)([a-z]?)(?:[/?#]|$)/))) {
    return `IRS Instr. ${m[1]}${m[2] ? m[2].toUpperCase() : ""}`;
  }
  if ((m = u.match(/publication-(\d+)/))) return `IRS Pub ${m[1]}`;
  if (u.includes("schedule-c")) return "Schedule C";
  if (u.includes("schedule-se")) return "Schedule SE";
  if ((m = u.match(/form-(\d+)/))) return `Form ${m[1]}`;
  if (u.includes("business-expense")) return "IRS business-expense guide";
  if (u.includes("records")) return "IRS recordkeeping";
  return "IRS guidance";
}
