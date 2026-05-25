"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Fixed left rail with a company-aware navigation tree.
 *
 * Information architecture (May 25 2026 restructure):
 *
 *   Dashboard                         ← top-level
 *   Companies ▾                       ← collapsible switcher
 *     • Company A
 *     • Company B
 *     + New company
 *   ──────────────────                ← separator (only when a company is active)
 *   [COMPANY NAME]                    ← active company header
 *   Forecast                          ← per-company surface
 *   Income
 *   Expenses
 *   Mileage
 *   Import
 *   Deductions
 *   Chat
 *   Settings                          ← (was "Setup")
 *
 * Previously the rail mixed user-level surfaces (Tax profile, Goals,
 * Reminders, Billing, Security, Your data, Recycle bin) into the same
 * top-level list. Those have moved entirely into the profile-icon
 * dropdown (UserMenu) because they're either account-wide or
 * configuration-grade — not the daily-workflow stuff the sidebar
 * should optimize for.
 *
 * Mileage stays in the per-company list even though its URL is
 * /mileage (top-level). The page reads the user's active company
 * internally; the link lives in the per-company group because the
 * user thinks of mileage as "per business" cognitively.
 *
 * "Settings is the new setup" — the old /c/[publicId]/setup route is
 * unchanged at the URL layer, only the label is renamed. Renaming the
 * route would have broken bookmarks + every redirect that already
 * encodes /setup.
 */

type Company = {
  publicId: string;
  name: string;
};

type Mode = "rail" | "sheet";

type Props = {
  /** "rail" pins to the viewport edge (lg+ default). "sheet" renders
   *  as a full-width drawer (mobile + tablet, opened via the FAB). */
  mode?: Mode;
  /** Sheet only: called when the user picks an item / taps the
   *  backdrop / hits Escape so the parent can close the drawer. */
  onDismiss?: () => void;
  /** Companies the user is a member of, used to populate the switcher.
   *  Server-fetched in AppHeader so first paint already has the list. */
  companies?: Company[];
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

// Per-company entries. `path` is appended to /c/{publicId}/<path>.
// `icon` is the inline SVG. Order here is the user-visible order.
const COMPANY_ITEMS: {
  key: string;
  label: string;
  path: string;
  icon: ReactNode;
}[] = [
  {
    key: "forecast",
    label: "Forecast",
    path: "forecast",
    icon: <Path d="M3 18l5-6 4 4 7-9M14 7h6v6" />,
  },
  {
    key: "income",
    label: "Income",
    path: "income",
    icon: <Path d="M12 3v14m0 0l-4-4m4 4l4-4M4 21h16" />,
  },
  {
    key: "expenses",
    label: "Expenses",
    path: "expenses",
    icon: <Path d="M12 21V7m0 0l-4 4m4-4l4 4M4 3h16" />,
  },
  {
    key: "mileage",
    // Mileage is top-level (/mileage) for now; the page picks the
    // active company internally. See file header.
    label: "Mileage",
    path: "__mileage_top_level__",
    icon: (
      <Path d="M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13M3 13h18v3a2 2 0 01-2 2h-1a2 2 0 01-2-2H8a2 2 0 01-2 2H5a2 2 0 01-2-2v-3z" />
    ),
  },
  {
    key: "import",
    label: "Import",
    path: "import",
    icon: <Path d="M4 17v3h16v-3M12 3v12m0 0l-4-4m4 4l4-4" />,
  },
  {
    key: "deductions",
    label: "Deductions",
    path: "my-deductions",
    icon: <Path d="M6 4h9l5 5v11a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1zM14 4v5h5M9 13h6M9 17h6" />,
  },
  {
    key: "chat",
    label: "Chat",
    path: "chat",
    icon: (
      <Path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 4v-4H6a2 2 0 01-2-2V6z" />
    ),
  },
  {
    key: "settings",
    label: "Settings",
    // Route name unchanged — only the label was renamed from "Setup".
    path: "setup",
    icon: (
      <Path d="M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zm0-6.5l1.5 2.5 2.8.6.6 2.8L19 10l-1.1 1.1.6 2.8-2.8.6L14.5 17H12l-1.5-2.5-2.8-.6-.6-2.8L5.5 10l1.1-1.1-.6-2.8 2.8-.6L10.5 3H12z" />
    ),
  },
];

function extractActivePublicId(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/c\/([^/]+)/);
  return m ? m[1] : null;
}

const LAST_COMPANY_KEY = "taxottic.last_company_public_id";

export function LeftRail({
  mode = "rail",
  onDismiss,
  companies = [],
}: Props) {
  const pathname = usePathname();
  const urlPublicId = extractActivePublicId(pathname);

  // Resolve the "effective" active company. If the URL is a /c/[publicId]
  // route, that wins. Otherwise we fall back to the last-visited company
  // from localStorage so adjacent top-level pages (e.g., /mileage,
  // /goals) keep the company section visible. /dashboard intentionally
  // hides the company section even if there's a last-visited — that's
  // the user's "blank slate" view.
  const [lastPublicId, setLastPublicId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAST_COMPANY_KEY);
      if (raw && typeof raw === "string") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration: localStorage isn't available during SSR
        setLastPublicId(raw);
      }
    } catch {
      /* private mode / corrupt → ignore */
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!urlPublicId) return;
    try {
      window.localStorage.setItem(LAST_COMPANY_KEY, urlPublicId);
    } catch {
      /* private mode / quota → ignore */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing latest URL companyId into local state
    setLastPublicId(urlPublicId);
  }, [urlPublicId]);

  const onDashboard = pathname === "/dashboard";
  const effectivePublicId =
    urlPublicId ?? (onDashboard ? null : lastPublicId);

  const activeCompany =
    effectivePublicId == null
      ? null
      : companies.find((c) => c.publicId === effectivePublicId) ?? null;

  // Switcher open by default if NO active company, closed if one is
  // selected (the user already knows which company they're on).
  const hasActiveCompany = activeCompany != null;
  const [switcherOpen, setSwitcherOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derive from effective state once mounted
    setSwitcherOpen(!hasActiveCompany);
  }, [hasActiveCompany]);

  function isActive(href: string) {
    if (!pathname) return false;
    const target = href.split("?")[0];
    if (target === pathname) return true;
    return target !== "/" && pathname.startsWith(target + "/");
  }

  function companyHref(path: string): string {
    if (path === "__mileage_top_level__") return "/mileage";
    if (!effectivePublicId) return "#";
    return `/c/${effectivePublicId}/${path}`;
  }

  const baseLink =
    "group/item flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors";

  // ---- styling parity with the prior flush sidebar ----
  //
  // `!fixed` (Tailwind's important modifier) is REQUIRED here because
  // globals.css has an UNLAYERED rule `main, footer, nav { position:
  // relative; z-index: 1 }` that wins over `@layer utilities`
  // regardless of specificity. Without the !, the rail ends up
  // position: relative — in-flow — and scrolls AWAY with the page
  // instead of staying pinned. (Discovered 2026-05-25 via Chrome MCP:
  // the rail rendered correctly at scrollY=0 then disappeared the
  // moment the user scrolled.) The same trick is documented for the
  // app header on lines 436-444 of globals.css.
  const railClass =
    mode === "rail"
      ? "!fixed left-0 z-40 hidden lg:flex flex-col " +
        "w-56 xl:w-60 2xl:w-64 " +
        "bg-paper/95 dark:bg-forest-800/95 " +
        "border-r border-forest-100 dark:border-forest-700 " +
        "rounded-r-2xl shadow-[2px_0_12px_rgba(18,26,42,0.06)] " +
        "px-2 pt-3 pb-3"
      : "card card-opaque relative w-64 max-w-[85vw] !rounded-r-2xl !rounded-l-none !p-2 flex flex-col";

  const railStyle =
    mode === "rail"
      ? {
          top: "calc(max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) + var(--app-header-h, 3.25rem))",
          bottom: "var(--safe-bottom, 0px)",
        }
      : undefined;

  // ---- top section: Dashboard + Companies switcher ----
  const topSection = (
    <div className="grid gap-1">
      <Link
        href="/dashboard"
        onClick={onDismiss}
        aria-current={onDashboard ? "page" : undefined}
        className={
          baseLink +
          (onDashboard
            ? " bg-cream text-forest-900 ring-1 ring-gold-200"
            : " text-forest-800 hover:bg-cream")
        }
      >
        <span className="shrink-0 text-forest-700 group-hover/item:text-forest-900">
          <Path d="M3 11l9-8 9 8M5 10v9h4v-6h6v6h4v-9" />
        </span>
        <span>Dashboard</span>
      </Link>

      <button
        type="button"
        onClick={() => setSwitcherOpen((o) => !o)}
        aria-expanded={switcherOpen}
        aria-controls="leftrail-company-switcher"
        className={
          baseLink +
          " w-full justify-between text-forest-800 hover:bg-cream"
        }
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 text-forest-700">
            <Path d="M4 21h16V8l-8-5-8 5v13zM10 21v-6h4v6" />
          </span>
          <span className="min-w-0 truncate">Companies</span>
        </span>
        <span
          aria-hidden="true"
          className={
            "shrink-0 text-ink-soft transition-transform " +
            (switcherOpen ? "rotate-180" : "")
          }
        >
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 5l3 3 3-3" />
          </svg>
        </span>
      </button>

      {switcherOpen ? (
        <ul
          id="leftrail-company-switcher"
          className="grid gap-0.5 ml-3 pl-3 border-l border-forest-100/70 dark:border-forest-700"
        >
          {companies.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-muted">
              No companies yet.
            </li>
          ) : (
            companies.map((c) => {
              const isCurrent = c.publicId === effectivePublicId;
              return (
                <li key={c.publicId}>
                  <Link
                    href={`/c/${c.publicId}/forecast`}
                    onClick={onDismiss}
                    aria-current={isCurrent ? "true" : undefined}
                    className={
                      "block rounded-lg px-3 py-1.5 text-[13px] truncate " +
                      (isCurrent
                        ? "bg-cream text-forest-900 font-medium"
                        : "text-forest-800 hover:bg-cream")
                    }
                    title={c.name}
                  >
                    {c.name}
                  </Link>
                </li>
              );
            })
          )}
          <li>
            <Link
              href="/companies/new"
              onClick={onDismiss}
              className="block rounded-lg px-3 py-1.5 text-[12px] text-ink-soft hover:bg-cream hover:text-forest-900"
            >
              + New company
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );

  // ---- per-company section ----
  const companySection =
    activeCompany == null ? null : (
      <div className="mt-3 grid gap-1">
        {/* Company name as section header. Gold-tinted caps so it
            reads as a label, not a clickable link. Truncates on
            long names — full name in the title attribute for hover. */}
        <div
          className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium truncate"
          title={activeCompany.name}
        >
          {activeCompany.name}
        </div>
        <ul className="grid gap-1" role="navigation">
          {COMPANY_ITEMS.map((item) => {
            const href = companyHref(item.path);
            const active = isActive(href);
            return (
              <li key={item.key}>
                <Link
                  href={href}
                  onClick={onDismiss}
                  aria-current={active ? "page" : undefined}
                  className={
                    baseLink +
                    (active
                      ? " bg-cream text-forest-900 ring-1 ring-gold-200"
                      : " text-forest-800 hover:bg-cream")
                  }
                  title={mode === "rail" ? item.label : undefined}
                >
                  <span className="shrink-0 text-forest-700 group-hover/item:text-forest-900">
                    {item.icon}
                  </span>
                  <span className="min-w-0 truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );

  return (
    <nav
      className={railClass + " group overflow-y-auto"}
      style={railStyle}
      aria-label="Main menu"
      suppressHydrationWarning
    >
      {topSection}
      {hydrated || mode === "sheet" ? (
        <>
          {/* Separator only when there IS a company section below */}
          {activeCompany ? (
            <div className="my-2 border-t border-forest-100/70 dark:border-forest-700" />
          ) : null}
          {companySection}
        </>
      ) : null}
    </nav>
  );
}
