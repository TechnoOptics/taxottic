"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type CompanyNavProps = {
  publicId: string;
  active:
    | "forecast"
    | "income"
    | "expenses"
    | "deductions"
    | "banks"
    | "sales-tax"
    | "import"
    | "profile"
    | "team"
    | "chat"
    | "preparer"
    | "mileage";
};

// `absolute` entries link to a global route (not /c/<id>/...). Mileage
// is an employee-wide dashboard, so it lives at /mileage.
const TABS = [
  { key: "forecast", label: "Forecast", path: "forecast" },
  { key: "income", label: "Income", path: "income" },
  { key: "expenses", label: "Expenses", path: "expenses" },
  { key: "deductions", label: "Deductions", path: "deductions" },
  { key: "mileage", label: "Mileage", path: "/mileage", absolute: true },
  { key: "banks", label: "Banks", path: "banks" },
  { key: "sales-tax", label: "Sales tax", path: "sales-tax" },
  { key: "import", label: "Import", path: "import" },
  { key: "profile", label: "Profile", path: "profile" },
  { key: "team", label: "Team", path: "manage" },
  { key: "chat", label: "Chat", path: "chat" },
  { key: "preparer", label: "Tax preparer", path: "preparer" },
] as const;

function hrefFor(publicId: string, t: (typeof TABS)[number]): string {
  return "absolute" in t && t.absolute ? t.path : `/c/${publicId}/${t.path}`;
}

/**
 * Company sub-navigation.
 *
 * Desktop (sm+): the familiar single row of tabs that wraps if needed.
 * Mobile (<sm): the 12 tabs are collapsed behind a "Sections" button
 * that opens a left slide-out drawer — tap the scrim, press Escape, or
 * swipe the drawer left to dismiss. This stops the tab block from
 * eating half the screen in a multi-row wrap on a phone.
 */
export function CompanyNav({ publicId, active }: CompanyNavProps) {
  const [open, setOpen] = useState(false);
  const current = TABS.find((t) => t.key === active);

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

      {/* Desktop: the classic tab row */}
      <ul className="hidden sm:flex flex-wrap gap-x-1 gap-y-0.5">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={hrefFor(publicId, t)}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "relative inline-flex h-11 items-center px-2.5 sm:px-4",
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
                const isActive = t.key === active;
                return (
                  <li key={t.key}>
                    <Link
                      href={hrefFor(publicId, t)}
                      onClick={() => setOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={[
                        "flex items-center gap-3 px-5 py-3 text-[15px]",
                        isActive
                          ? "text-forest-900 font-semibold bg-gold-400/10"
                          : "text-ink-soft hover:bg-forest-50 dark:hover:bg-forest-800",
                      ].join(" ")}
                    >
                      <span
                        aria-hidden="true"
                        className={[
                          "h-5 w-[3px] rounded-full",
                          isActive ? "bg-gold-500" : "bg-transparent",
                        ].join(" ")}
                      />
                      {t.label}
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
