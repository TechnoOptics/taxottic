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
 * configuration-grade, not the daily-workflow stuff the sidebar
 * should optimize for.
 *
 * Mileage stays in the per-company list even though its URL is
 * /mileage (top-level). The page reads the user's active company
 * internally; the link lives in the per-company group because the
 * user thinks of mileage as "per business" cognitively.
 *
 * "Settings is the new setup", the old /c/[publicId]/setup route is
 * unchanged at the URL layer, only the label is renamed. Renaming the
 * route would have broken bookmarks + every redirect that already
 * encodes /setup.
 */

type Company = {
  publicId: string;
  name: string;
  role?: "manager" | "lead" | "member" | "expenser";
};

// Nav items visible to a plain "member" (not a manager). Members get the
// day-to-day workflow, add expenses, track mileage, chat, see the team,
// edit their own profile, not the tax-planning/admin surfaces (Forecast,
// Income, Import, deduction explorer, company-wide Activity feed).
// Managers see every item in COMPANY_ITEMS, unfiltered.
const MEMBER_VISIBLE_KEYS = new Set([
  "expenses",
  "mileage",
  "chat",
  "team",
  "settings",
]);

// A department lead sees everything a manager does EXCEPT company-wide
// financial input (Income, Import), their review/forecast rights are
// scoped to their own department at the page/RLS level, but company-wide
// income entry stays a manager-only surface.
const LEAD_HIDDEN_KEYS = new Set(["income", "import"]);

// Narrowest role: can only log their own expenses/mileage and use chat.
// No forecast, income, roster, deduction explorer, or settings surfaces.
const EXPENSER_VISIBLE_KEYS = new Set(["expenses", "mileage", "chat"]);

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
  /** Employee-only accounts without their own paid personal plan: the
   *  personal workspace is replaced by an upgrade upsell (they get the
   *  business side only). Owners/subscribers see the full personal nav. */
  personalLocked?: boolean;
};

// Shared icon frame, outline style, 24×24, matched to the app's UI weight.
// Use <Icon> for multi-element glyphs (path + circle, etc.); <Path> is the
// single-path shorthand.
function Icon({ children }: { children: ReactNode }) {
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
      {children}
    </svg>
  );
}

function Path({ d }: { d: string }) {
  return (
    <Icon>
      <path d={d} />
    </Icon>
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
      <Icon>
        <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
        <circle cx="7" cy="17" r="2" />
        <path d="M9 17h6" />
        <circle cx="17" cy="17" r="2" />
      </Icon>
    ),
  },
  {
    key: "import",
    label: "Import",
    path: "import",
    icon: <Path d="M4 17v3h16v-3M12 3v12m0 0l-4-4m4 4l4-4" />,
  },
  {
    key: "explore",
    label: "Explore deductions",
    // The deduction explorer, ~1,000 IRS-sourced deductions, searchable
    // and filtered to the company's entity type. Promoted to a top-level
    // rail item (was only reachable via inline links from Forecast / My
    // deductions). Compass = "explore what you can claim".
    path: "deductions",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88" />
      </Icon>
    ),
  },
  {
    key: "deductions",
    label: "My deductions",
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
    key: "team",
    label: "Team",
    // Links straight to /manage (the real page); /team is only a 308
    // redirect shim, so pointing at "manage" keeps the active-state
    // match honest. Roster, invites, and per-member spend live there.
    path: "manage",
    icon: (
      <Path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    ),
  },
  {
    key: "activity",
    label: "Activity",
    path: "activity",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </Icon>
    ),
  },
  {
    key: "settings",
    label: "Settings",
    // Route name unchanged, only the label was renamed from "Setup".
    path: "setup",
    icon: (
      <Icon>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </Icon>
    ),
  },
];

// Personal-workspace entries. `href` is an absolute route (these are NOT
// under /c/{publicId}). This is the individual-tax side, deliberately free
// of anything business: no company, no mileage, no chat, no team. The
// Business toggle is how you cross over to a company's own nav.
// (Dashboard is rendered separately as a pinned link above the mode
// sections, so it shows in BOTH personal and business mode.)
const PERSONAL_ITEMS: {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
}[] = [
  {
    key: "forecast",
    label: "Forecast",
    href: "/personal/forecast",
    icon: <Path d="M3 18l5-6 4 4 7-9M14 7h6v6" />,
  },
  {
    key: "deductions",
    label: "Deductions",
    href: "/personal/expenses",
    icon: <Path d="M6 4h9l5 5v11a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1zM14 4v5h5M9 13h6M9 17h6" />,
  },
  {
    key: "playbook",
    // Personal tax-savings playbook: IRS-cited individual moves
    // (401k/IRA/HSA/FSA/529/harvesting/credits), same engine as the
    // company playbook but fed only personal inputs.
    label: "Playbook",
    href: "/personal/playbook",
    icon: (
      <Icon>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </Icon>
    ),
  },
  {
    key: "goals",
    label: "Goals",
    href: "/goals",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </Icon>
    ),
  },
  {
    key: "export",
    label: "Export",
    href: "/personal/export",
    icon: <Path d="M4 17v3h16v-3M12 3v12m0 0l-4-4m4 4l4-4" />,
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
  personalLocked = false,
}: Props) {
  const pathname = usePathname();
  const urlPublicId = extractActivePublicId(pathname);

  // Resolve the "effective" active company. If the URL is a /c/[publicId]
  // route, that wins. Otherwise we fall back to the last-visited company
  // from localStorage so adjacent top-level pages (e.g., /mileage,
  // /goals) keep the company section visible. /dashboard intentionally
  // hides the company section even if there's a last-visited, that's
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

  // Resolve the effective active company for the nav. Priority:
  //   1. The /c/[publicId] route in the URL.
  //   2. The last company the user visited (localStorage).
  //   3. The user's only company, if they have exactly one.
  // Previously /dashboard forced this to null as a "blank slate," but
  // that made the menu look empty/confusing on first open (just
  // "Dashboard" + an auto-expanded company list, none of the actual
  // nav). Showing the active company's section everywhere, including
  // the dashboard, makes the menu feel complete and consistent. The
  // switcher still auto-opens only when there's genuinely no active
  // company to fall back on (multi-company users who haven't picked one
  // yet).
  const soleCompanyId =
    companies.length === 1 ? companies[0].publicId : null;
  const effectivePublicId =
    urlPublicId ?? lastPublicId ?? soleCompanyId;

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
  // position: relative, in-flow, and scrolls AWAY with the page
  // instead of staying pinned. (Discovered 2026-05-25 via Chrome MCP:
  // the rail rendered correctly at scrollY=0 then disappeared the
  // moment the user scrolled.) The same trick is documented for the
  // app header on lines 436-444 of globals.css.
  const railClass =
    mode === "rail"
      ? // Anchored to the left edge: rounded on the RIGHT only, a hairline
        // right border + soft right shadow, spanning from just below the
        // header to the bottom. Solid and connected to the page (not a
        // detached floating card).
        "!fixed left-0 z-40 hidden lg:flex flex-col " +
        "w-56 xl:w-60 2xl:w-64 " +
        "bg-paper/95 dark:bg-forest-800/95 " +
        "border-r border-forest-100 dark:border-forest-700 " +
        "rounded-r-2xl shadow-[2px_0_16px_rgba(18,26,42,0.10)] " +
        "px-2 pt-3 pb-3"
      : // Floating sheet: unlike the rail (flush to the screen edge, so
        // only its outer corners round), the sheet sits with a gap on
        // every side, squaring off its left edge read as unfinished
        // next to the rest of the app's uniformly-rounded `.card`
        // surfaces. Full rounding + a touch more padding brings it in
        // line with that language.
        "card card-opaque relative w-64 max-w-[85vw] !rounded-2xl p-2.5 flex flex-col";

  const railStyle =
    mode === "rail"
      ? {
          // Start just below the header (small gap so it doesn't touch the
          // header bar) and run to the bottom, flush to the left edge.
          top: "calc(max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) + var(--app-header-h, 3.25rem) + 0.75rem)",
          bottom: "var(--safe-bottom, 0px)",
        }
      : undefined;

  // ---- top section: Dashboard + Companies switcher ----
  // Personal / Business workspace toggle. Personal = the individual tax
  // side; Business = the active company. Business unlocks only once the user
  // belongs to a company (created one or was invited), item 2.
  const hasBusiness = companies.length > 0;
  const onBusiness =
    urlPublicId != null ||
    (pathname?.startsWith("/c/") ?? false) ||
    // Mileage is a top-level route (/mileage) but is business-only, so it
    // counts as the business workspace: keeps the company nav visible
    // while you're on it, and keeps "Mileage" out of the personal menu.
    (pathname?.startsWith("/mileage") ?? false);
  const businessHref = effectivePublicId
    ? `/c/${effectivePublicId}/forecast`
    : "/companies/new";
  const segBase =
    "rounded-lg px-2 py-1.5 text-[13px] font-medium text-center transition-colors ";
  const segActive =
    "bg-white dark:bg-forest-800 text-forest-900 dark:text-cream shadow-sm";
  const segIdle = "text-forest-700 dark:text-cream/70 hover:text-forest-900";

  // Personal / Business segmented toggle, always visible so the user can
  // cross between the two workspaces from anywhere.
  const toggleSection = (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-cream/70 dark:bg-forest-700/60 p-1 mb-1">
      <Link
        href={personalLocked ? "/personal/upgrade" : "/personal/forecast"}
        onClick={onDismiss}
        aria-current={!onBusiness ? "true" : undefined}
        className={segBase + (!onBusiness ? segActive : segIdle)}
      >
        Personal
      </Link>
      <Link
        href={hasBusiness ? businessHref : "/companies/new"}
        onClick={onDismiss}
        aria-current={onBusiness ? "true" : undefined}
        title={
          hasBusiness
            ? undefined
            : "Create or join a company to unlock the business side"
        }
        className={
          segBase +
          (onBusiness ? segActive : segIdle) +
          (hasBusiness ? "" : " opacity-60")
        }
      >
        Business
      </Link>
    </div>
  );

  // Employee-only accounts without a personal plan don't get the personal
  // nav at all — a single upsell entry replaces it (their work side is
  // fully available on the Business tab). Owners/subscribers skip this.
  const personalUpsell = (
    <ul className="grid gap-1" role="navigation">
      <li>
        <Link
          href="/personal/upgrade"
          onClick={onDismiss}
          className={baseLink + " text-forest-800 hover:bg-cream"}
          title={mode === "rail" ? "Personal tax tools" : undefined}
        >
          <span className="shrink-0 text-gold-600">
            <Icon>
              <Path d="M12 2l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 15.9 6.8 18.2l1-5.8L3.5 8.2l5.9-.9z" />
            </Icon>
          </span>
          <span className="min-w-0 truncate">Get personal tax tools</span>
        </Link>
      </li>
    </ul>
  );

  // Personal workspace nav (individual tax side). Deliberately free of
  // anything business, no company, no mileage, no chat, no team.
  const personalSection = personalLocked ? (
    personalUpsell
  ) : (
    <ul className="grid gap-1" role="navigation">
      {PERSONAL_ITEMS.map((item) => {
        const active = isActive(item.href);
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              onClick={onDismiss}
              aria-current={active ? "page" : undefined}
              className={
                baseLink +
                (active
                  ? " bg-cream text-forest-900 ring-1 ring-gold-300/70 font-medium"
                  : " text-forest-800 hover:bg-cream")
              }
              title={mode === "rail" ? item.label : undefined}
            >
              <span
                className={
                  "shrink-0 " +
                  (active
                    ? "text-gold-600"
                    : "text-forest-700 group-hover/item:text-forest-900")
                }
              >
                {item.icon}
              </span>
              <span className="min-w-0 truncate">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  // Company switcher (business workspace only): the expandable list of the
  // user's companies + "New company".
  const companiesSwitcher = (
    <div className="grid gap-1">
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
        {/* Company identity chip as the section header: a serif monogram
            in a navy tile (gold letter + hairline gold ring, echoing the
            dashboard company card) next to the gold-caps name. Gives the
            per-company section a sense of "whose books am I in" instead of
            a bare text label. Truncates on long names; full name on hover. */}
        <div
          className="flex items-center gap-2.5 px-2 pt-2 pb-1 min-w-0"
          title={activeCompany.name}
        >
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-forest-900 text-gold-300 text-[13px] leading-none ring-1 ring-gold-300/40"
            style={{ fontFamily: "var(--font-display)" }}
            aria-hidden="true"
          >
            {activeCompany.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 truncate text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
            {activeCompany.name}
          </span>
        </div>
        <ul className="grid gap-1" role="navigation">
          {(activeCompany.role === "manager"
            ? COMPANY_ITEMS
            : activeCompany.role === "lead"
              ? COMPANY_ITEMS.filter((item) => !LEAD_HIDDEN_KEYS.has(item.key))
              : activeCompany.role === "expenser"
                ? COMPANY_ITEMS.filter((item) =>
                    EXPENSER_VISIBLE_KEYS.has(item.key),
                  )
                : COMPANY_ITEMS.filter((item) =>
                    MEMBER_VISIBLE_KEYS.has(item.key),
                  )
          ).map((item) => {
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
                      ? " bg-cream text-forest-900 ring-1 ring-gold-300/70 font-medium"
                      : " text-forest-800 hover:bg-cream")
                  }
                  title={mode === "rail" ? item.label : undefined}
                >
                  <span
                    className={
                      "shrink-0 " +
                      (active
                        ? "text-gold-600"
                        : "text-forest-700 group-hover/item:text-forest-900")
                    }
                  >
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
      {mode === "sheet" ? (
        <div className="flex items-center justify-between px-2 pt-1 pb-2">
          <span className="text-[10px] uppercase tracking-[0.2em] text-ink-muted font-medium">
            Menu
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close menu"
            className="size-8 rounded-full grid place-items-center text-ink-soft hover:bg-cream hover:text-forest-900 transition-colors"
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M3 3 L13 13 M13 3 L3 13" />
            </svg>
          </button>
        </div>
      ) : null}
      {toggleSection}
      {/* Dashboard placement is mode-aware. For a user with businesses,
          /dashboard is the OWNER hub ("Your businesses", company cards) —
          business content — so on the Personal side it must not appear;
          it stays pinned in Business mode. For a user with NO companies
          (pure individual filer) /dashboard renders the personal
          dashboard, so it stays in Personal mode for them. */}
      {onBusiness || !hasBusiness ? (
      <div className="grid gap-1 mb-1">
        <Link
          href="/dashboard"
          onClick={onDismiss}
          aria-current={isActive("/dashboard") ? "page" : undefined}
          className={
            baseLink +
            (isActive("/dashboard")
              ? " bg-cream text-forest-900 ring-1 ring-gold-300/70 font-medium"
              : " text-forest-800 hover:bg-cream")
          }
          title={mode === "rail" ? "Dashboard" : undefined}
        >
          <span
            className={
              "shrink-0 " +
              (isActive("/dashboard")
                ? "text-gold-600"
                : "text-forest-700 group-hover/item:text-forest-900")
            }
          >
            <Path d="M3 11l9-8 9 8M5 10v9h4v-6h6v6h4v-9" />
          </span>
          <span className="min-w-0 truncate">Dashboard</span>
        </Link>
      </div>
      ) : null}
      {/* Personal mode: individual-tax nav only. No company, no mileage,
          no chat, no team. Static routes, so no hydration gate needed. */}
      {!onBusiness ? <div className="grid gap-1">{personalSection}</div> : null}
      {/* Business mode: the company switcher + the active company's nav.
          Gated on hydration because the effective company can come from
          localStorage when the URL doesn't carry a /c/[publicId]. */}
      {onBusiness && (hydrated || mode === "sheet") ? (
        <div className="grid gap-1">
          {companiesSwitcher}
          {/* Separator only when there IS a company section below */}
          {activeCompany ? (
            <div className="my-2 border-t border-forest-100/70 dark:border-forest-700" />
          ) : null}
          {companySection}
        </div>
      ) : null}
    </nav>
  );
}
