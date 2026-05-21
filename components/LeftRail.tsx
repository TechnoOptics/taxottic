"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Fixed left rail with the consumer-app navigation items.
 *
 * Surfaces what used to live inside the top-right user-menu dropdown
 * as a persistent rounded panel anchored to the left edge of the
 * viewport. On lg+ screens the rail is always visible; on smaller
 * screens it's hidden and the AppHeader's hamburger opens it as a
 * sheet (rendered with the same component, mode="sheet").
 *
 * Layout strategy: position: fixed; left: 8px. The rail floats in
 * the natural side margin on standard desktop widths (max-w-Xxl
 * content is centered, leaving ~200px+ on either side at 1280px+),
 * so existing page layouts don't need any new padding. The rail is
 * 64 px wide collapsed → expands to 224 px on hover (showing labels)
 * and stays expanded while a reorder mode is active.
 *
 * Reorder: the user can click "Reorder" to enter edit mode, then
 * tap the up/down arrows on any item to nudge it. We picked simple
 * arrow controls instead of HTML5 drag-and-drop because DnD breaks
 * on touch devices and the rail has to work on the phone. Order
 * persists to localStorage under taxottic.nav_order so it survives
 * reload without a DB round-trip.
 */

const DEFAULT_ORDER: ItemKey[] = [
  "dashboard",
  "mileage",
  "tax_profile",
  "goals",
  "reminders",
  "billing",
  "security",
  "your_data",
  "recycle_bin",
];

type ItemKey =
  | "dashboard"
  | "mileage"
  | "tax_profile"
  | "goals"
  | "reminders"
  | "billing"
  | "security"
  | "your_data"
  | "recycle_bin";

type ItemDef = {
  key: ItemKey;
  label: string;
  href: string;
  icon: ReactNode;
};

const ITEMS: Record<ItemKey, ItemDef> = {
  dashboard: {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <Path d="M3 11l9-8 9 8M5 10v9h4v-6h6v6h4v-9" />
    ),
  },
  mileage: {
    key: "mileage",
    label: "Mileage",
    href: "/mileage",
    // Steering wheel-ish: car silhouette + a wheel below.
    icon: (
      <Path d="M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13M3 13h18v3a2 2 0 01-2 2h-1a2 2 0 01-2-2H8a2 2 0 01-2 2H5a2 2 0 01-2-2v-3zM7 16h.01M17 16h.01" />
    ),
  },
  tax_profile: {
    key: "tax_profile",
    label: "Tax profile",
    href: "/onboarding/tax-profile?next=/dashboard",
    icon: <Path d="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0" />,
  },
  goals: {
    key: "goals",
    label: "Goals",
    href: "/goals",
    icon: <Path d="M12 2a10 10 0 100 20 10 10 0 000-20zM12 7v5l3 2" />,
  },
  reminders: {
    key: "reminders",
    label: "Reminders",
    href: "/reminders",
    icon: <Path d="M6 8a6 6 0 1112 0v5l2 3H4l2-3V8zm4 11a2 2 0 004 0" />,
  },
  billing: {
    key: "billing",
    label: "Billing & plan",
    href: "/billing",
    icon: <Path d="M3 7h18v10H3zM3 11h18M7 15h3" />,
  },
  security: {
    key: "security",
    label: "Security",
    href: "/settings/security",
    icon: (
      <Path d="M12 3l8 3v5c0 5-4 9-8 10-4-1-8-5-8-10V6l8-3z" />
    ),
  },
  your_data: {
    key: "your_data",
    label: "Your data",
    href: "/settings/data",
    icon: (
      <Path d="M4 7c0-2 4-3 8-3s8 1 8 3-4 3-8 3-8-1-8-3zm0 5c0 2 4 3 8 3s8-1 8-3M4 7v10c0 2 4 3 8 3s8-1 8-3V7" />
    ),
  },
  recycle_bin: {
    key: "recycle_bin",
    label: "Recycle bin",
    href: "/settings/recycle-bin",
    icon: (
      <Path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
    ),
  },
};

type Mode = "rail" | "sheet";
type Props = {
  /** "rail" pins to the viewport edge (lg+ default). "sheet" renders
   *  as a full-width drawer (mobile + tablet, opened via hamburger). */
  mode?: Mode;
  /** Sheet only: called when the user picks an item / taps the
   *  backdrop / hits Escape so the parent can close the drawer. */
  onDismiss?: () => void;
};

function Path({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const ORDER_KEY = "taxottic.nav_order";

export function LeftRail({ mode = "rail", onDismiss }: Props) {
  const pathname = usePathname();
  const [order, setOrder] = useState<ItemKey[]>(DEFAULT_ORDER);
  const [hydrated, setHydrated] = useState(false);
  const [reordering, setReordering] = useState(false);

  // Hydrate from localStorage AFTER mount so SSR + first client
  // render both produce the default order — avoids hydration
  // mismatch warnings.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const known = parsed.filter((k): k is ItemKey =>
            typeof k === "string" && k in ITEMS,
          );
          // Append any new defaults the user hasn't seen yet (e.g.,
          // we add a new menu item in a later release) so they don't
          // silently disappear after a code update.
          for (const k of DEFAULT_ORDER) {
            if (!known.includes(k)) known.push(k);
          }
          setOrder(known);
        }
      }
    } catch {
      /* corrupt JSON / Safari private mode → fall back to default */
    }
    setHydrated(true);
  }, []);

  function persist(next: ItemKey[]) {
    setOrder(next);
    try {
      window.localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {
      /* QuotaExceeded / private mode — non-fatal */
    }
  }

  function move(key: ItemKey, dir: -1 | 1) {
    const idx = order.indexOf(key);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[idx], next[target]] = [next[target], next[idx]];
    persist(next);
  }

  function resetOrder() {
    persist([...DEFAULT_ORDER]);
  }

  function isActive(href: string) {
    if (!pathname) return false;
    // Strip query string from href before comparing — pathname
    // never contains one.
    const target = href.split("?")[0];
    if (target === pathname) return true;
    // "/settings" is an ancestor of "/settings/security"; don't
    // light up Security when the user is on /settings.
    return target !== "/" && pathname.startsWith(target + "/");
  }

  const baseLink =
    "group/item flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors";

  // Expand-on-hover on the desktop rail; sheet mode is always wide.
  // `card card-opaque` gives us the right surface in BOTH themes —
  // white in light mode, forest-800 in dark mode — automatically via
  // the existing globals.css overrides. The previous `bg-paper/95`
  // didn't flip in dark mode, leaving a stark white block on the
  // navy page (May 20 regression report).
  //
  // `!fixed` (Tailwind's important modifier) is REQUIRED because the
  // `.card` class in globals.css sets `position: relative` which
  // beats Tailwind's `fixed` utility on equal specificity (`.card`
  // is defined AFTER the utilities layer). Without the !, the rail
  // ended up in-flow and pushed the dashboard content ~570px down.
  const railClass =
    mode === "rail"
      ? // The fixed rail is now ALWAYS expanded at 224px (was
        // collapsed-icons-with-hover-expand). User feedback: the
        // hover-to-reveal felt fiddly and labels are the whole
        // point of nav. The desktop rail has plenty of horizontal
        // room next to a max-w-6xl centered content column, so
        // staying open costs nothing and removes a click.
        // Position: fixed keeps it pinned without affecting layout.
        "card card-opaque !fixed left-2 z-40 !rounded-2xl !p-2 " +
        "hidden lg:flex flex-col w-56"
      : // Sheet mode (mobile drawer) — full-width content panel
        // inside a backdrop. Parent controls the open state +
        // backdrop click. card-opaque so it survives dark theme.
        // `.card` already sets position: relative, which is fine
        // for this mode — no !important needed.
        "card card-opaque relative w-72 max-w-[85vw] !rounded-r-2xl !rounded-l-none !p-2 flex flex-col";

  // Position: vertically centered on the left edge (was top-anchored
  // just below the header). The user feedback was that the rail
  // crowded the top of the viewport and "overlay the status bar +
  // header" on mobile — moving it to mid-left lets it float as a
  // proper rail with the brand mark + header completely unobstructed
  // above. maxHeight still respects safe-bottom + an extra hint so
  // the rail never grows tall enough to bump back into the header.
  const railStyle =
    mode === "rail"
      ? {
          top: "50%",
          transform: "translateY(-50%)",
          maxHeight:
            "calc(100vh - max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) - var(--safe-bottom) - 7rem)",
        }
      : undefined;

  const list = (
    <ul className="grid gap-1 flex-1 overflow-y-auto" role="navigation">
      {order.map((key) => {
        const item = ITEMS[key];
        const active = isActive(item.href);
        return (
          <li key={key}>
            <div className="flex items-stretch gap-1">
              <Link
                href={item.href}
                onClick={onDismiss}
                aria-current={active ? "page" : undefined}
                className={
                  baseLink +
                  " flex-1 min-w-0 " +
                  (active
                    ? "bg-cream text-forest-900 ring-1 ring-gold-200"
                    : "text-forest-800 hover:bg-cream")
                }
                title={mode === "rail" ? item.label : undefined}
              >
                <span className="shrink-0 text-forest-700 group-hover/item:text-forest-900">
                  {item.icon}
                </span>
                <span className="min-w-0 truncate">
                  {/* Labels are always visible now (rail is
                      always-expanded). Previously the rail
                      collapsed-with-hover-reveal so labels were
                      opacity-0 until hover. Always-open removes
                      that gate. */}
                  {item.label}
                </span>
              </Link>
              {reordering ? (
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(key, -1)}
                    disabled={order.indexOf(key) === 0}
                    aria-label={`Move ${item.label} up`}
                    className="size-5 rounded-md border border-forest-100 text-forest-700 hover:bg-cream disabled:opacity-30 disabled:cursor-not-allowed grid place-items-center"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 12l4-4 4 4"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(key, 1)}
                    disabled={order.indexOf(key) === order.length - 1}
                    aria-label={`Move ${item.label} down`}
                    className="size-5 rounded-md border border-forest-100 text-forest-700 hover:bg-cream disabled:opacity-30 disabled:cursor-not-allowed grid place-items-center"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 8l4 4 4-4"
                      />
                    </svg>
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );

  const footer = (
    <div className="border-t border-forest-100 mt-2 pt-2 grid gap-1">
      {reordering ? (
        <>
          <button
            type="button"
            onClick={resetOrder}
            className="text-[11px] text-ink-muted hover:text-forest-900 underline underline-offset-2 px-2 py-1 text-left"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={() => setReordering(false)}
            className="btn-primary text-xs h-8"
          >
            Done
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setReordering(true)}
          className="rounded-lg px-3 py-2 text-xs text-forest-700 hover:bg-cream flex items-center gap-2 justify-start"
          title="Reorder menu items"
        >
          <svg
            viewBox="0 0 20 20"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
            className="shrink-0"
          >
            <path strokeLinecap="round" d="M3 6h14M3 10h14M3 14h14" />
          </svg>
          {mode === "rail" ? (
            <span className="opacity-0 group-hover:opacity-100 transition-opacity">
              Reorder
            </span>
          ) : (
            <span>Reorder menu</span>
          )}
        </button>
      )}
    </div>
  );

  // Suppress hydration mismatch warning since the localStorage read
  // happens post-mount and re-renders with the persisted order.
  return (
    <nav
      className={railClass + " group"}
      style={railStyle}
      aria-label="Main menu"
      suppressHydrationWarning
    >
      {hydrated || mode === "sheet" ? (
        <>
          {list}
          {footer}
        </>
      ) : (
        // SSR placeholder so the rail's geometry doesn't pop during
        // hydration. Renders the default order without the reorder
        // affordance; effectively invisible on the first paint.
        list
      )}
    </nav>
  );
}
