"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * The 5 user-goal groups. Legacy section keys still get passed by
 * detail pages (`active="income"`, `active="expenses"`, etc.) and we
 * map them down to one of these five so the right tab lights up.
 */
type TabKey =
  | "forecast"
  | "money-in"
  | "money-out"
  | "setup"
  | "talk";

/**
 * Every section key the codebase passes today. Most of these are
 * historic - the old IA had 12 top tabs (`income`, `expenses`, etc.).
 * They're still accepted so each detail page keeps lighting up the
 * correct group tab.
 */
type LegacyKey =
  | "income"
  | "expenses"
  | "deductions"
  | "mileage"
  | "banks"
  | "sales-tax"
  | "import"
  | "profile"
  | "team"
  | "chat"
  | "preparer";

type CompanyNavProps = {
  publicId: string;
  active: TabKey | LegacyKey;
};

/**
 * Maps every accepted `active` key down to its group tab so legacy
 * detail pages don't need to change to keep lighting the right tab.
 */
const LEGACY_TO_GROUP: Record<LegacyKey, TabKey> = {
  income: "money-in",
  expenses: "money-out",
  deductions: "money-out",
  mileage: "money-out",
  "sales-tax": "money-out",
  banks: "setup",
  import: "setup",
  profile: "setup",
  team: "setup",
  chat: "talk",
  preparer: "talk",
};

/**
 * The 5 visible tabs. Each one routes to a hub page that lives at
 * /c/<id>/<path>; the hubs gather every related sub-tool as cards
 * on a single scrollable page so users never hit "tabs within tabs."
 */
const TABS: { key: TabKey; label: string; path: string; subtitle: string }[] = [
  {
    key: "forecast",
    label: "Forecast",
    path: "forecast",
    subtitle: "Tax + savings",
  },
  {
    key: "money-in",
    label: "Money in",
    path: "money-in",
    subtitle: "Income",
  },
  {
    key: "money-out",
    label: "Money out",
    path: "money-out",
    subtitle: "Expenses, mileage, sales tax, deductions",
  },
  {
    key: "setup",
    label: "Setup",
    path: "setup",
    subtitle: "Profile, team, banks, imports",
  },
  { key: "talk", label: "Talk", path: "talk", subtitle: "Chat + tax preparer" },
];

function resolveGroup(active: TabKey | LegacyKey): TabKey {
  return (LEGACY_TO_GROUP as Record<string, TabKey>)[active] ?? (active as TabKey);
}

/**
 * Top-level case (company) sub-navigation, restyled v2.
 *
 * Down from 12 to 5 group tabs after a user complaint that the old
 * strip felt like a maze. Detail pages (Income, Expenses, Mileage,
 * Sales tax, Deductions, Banks, Import, Profile, Team, Chat, Tax
 * preparer) still exist at their original URLs and still pass their
 * own `active="..."` key - we just translate it to the correct
 * group so the visible 5-tab strip lights up the parent tab. Tab
 * clicks always go to the hub page (`/c/<id>/<group-path>`); the
 * hubs render every sub-tool as a card so the user never has to
 * dig.
 *
 * Desktop (sm+): a single horizontal row of 5 tabs. Mobile (<sm):
 * the row is collapsed behind a "Sections" button that opens a
 * left slide-out drawer.
 */
export function CompanyNav({ publicId, active }: CompanyNavProps) {
  const [open, setOpen] = useState(false);
  const group = resolveGroup(active);
  const current = TABS.find((t) => t.key === group);

  // Lock body scroll + close on Escape while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Swipe the drawer left to close.
  const startX = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startX.current == null || !panelRef.current) return;
    const dx = e.touches[0].clientX - startX.current;
    if (dx < 0) panelRef.current.style.transform = `translateX(${dx}px)`;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current == null || !panelRef.current) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    panelRef.current.style.transform = "";
    if (dx < -60) setOpen(false);
    startX.current = null;
  };

  return (
    <nav className="relative" aria-label="Company sections">
      {/* Mobile: trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sm:hidden inline-flex h-11 items-center gap-2 px-3 text-sm text-forest-900 font-medium"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>{current?.label ?? "Sections"}</span>
        <span aria-hidden="true" className="text-ink-soft">▾</span>
      </button>

      {/* Desktop: 5-tab strip */}
      <ul className="hidden sm:flex flex-wrap gap-x-1 gap-y-0.5">
        {TABS.map((t) => {
          const isActive = t.key === group;
          return (
            <li key={t.key}>
              <Link
                href={`/c/${publicId}/${t.path}`}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "relative inline-flex h-11 items-center px-3 sm:px-5",
                  "text-sm tracking-wide -mb-px transition-colors",
                  isActive
                    ? "text-forest-900 font-medium"
                    : "text-ink-soft hover:text-forest-800",
                ].join(" ")}
              >
                {t.label}
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full"
                    style={{
                      background:
                        "linear-gradient(90deg, transparent, var(--color-gold-400) 30%, var(--color-gold-500) 50%, var(--color-gold-400) 70%, transparent)",
                    }}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div
        aria-hidden="true"
        className="absolute left-0 right-0 bottom-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(213, 187, 126, 0.45) 8%, rgba(29, 40, 67, 0.18) 50%, rgba(213, 187, 126, 0.45) 92%, transparent)",
        }}
      />

      {/* Mobile drawer */}
      {open ? (
        <div className="sm:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Company sections">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-[1px] animate-[fadeIn_.15s_ease]"
          />
          <div
            ref={panelRef}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            className="absolute left-0 top-0 h-full w-[78%] max-w-xs bg-cream dark:bg-forest-900 shadow-2xl flex flex-col transition-transform"
            style={{
              paddingTop: "var(--app-safe-top, env(safe-area-inset-top, 0px))",
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-forest-100/40">
              <span className="text-xs uppercase tracking-[0.2em] text-gold-700">
                Sections
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-ink-soft hover:bg-forest-50 dark:hover:bg-forest-800"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto py-2">
              {TABS.map((t) => {
                const isActive = t.key === group;
                return (
                  <li key={t.key}>
                    <Link
                      href={`/c/${publicId}/${t.path}`}
                      onClick={() => setOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={[
                        "flex items-start gap-3 px-5 py-3 text-[15px]",
                        isActive
                          ? "text-forest-900 font-semibold bg-gold-400/10"
                          : "text-ink-soft hover:bg-forest-50 dark:hover:bg-forest-800",
                      ].join(" ")}
                    >
                      <span
                        aria-hidden="true"
                        className={[
                          "mt-1 h-5 w-[3px] rounded-full",
                          isActive ? "bg-gold-500" : "bg-transparent",
                        ].join(" ")}
                      />
                      <span className="flex-1">
                        <span className="block">{t.label}</span>
                        <span className="block text-[12px] text-ink-soft/80 mt-0.5">
                          {t.subtitle}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
