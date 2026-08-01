"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FeedbackModal } from "./FeedbackModal";
import { ThemeToggle } from "./ThemeToggle";
import { WebOnly } from "./WebOnly";
import type { Plan } from "@/lib/plans/limits";

type Platform = "user" | "enterprise" | "hq";

type Props = {
  email: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
  // When true, swap the customer-app navigation list for an
  // admin-only short list (sign out + jump back to taxottic.com).
  // Used on hq.taxottic.com so super-admins don't see broken links
  // to /dashboard, /goals, etc. that don't exist on the admin host.
  adminMode?: boolean;
  /**
   * True when the signed-in user is a super-admin (per the
   * super_admins seed table). When true, the dropdown shows a
   * "Switch portal" section that lets them jump between the three
   * platforms (Consumer / Enterprise / HQ).
   */
  isSuperAdmin?: boolean;
  /**
   * The user's currently active platform, used to mark the right
   * option in the switcher. Defaults to "user" if not provided.
   */
  currentPlatform?: Platform | null;
  /**
   * Server action that updates profiles.active_platform AND redirects
   * to the platform's landing page. Passed in from the server-side
   * AppHeader so the menu can wire each option to a single-button
   * <form action={setPlatformAction}>.
   */
  setPlatformAction?: (formData: FormData) => Promise<void>;
  /**
   * Server action that records a feedback submission. When provided,
   * the dropdown renders a "Send feedback" item that opens the
   * modal. Previously the same modal lived behind a floating FAB
   * above the Bella button - we removed the FAB and re-anchored the
   * entry point here per product feedback ("two stacked bubbles
   * looked cluttered").
   */
  submitFeedbackAction?: (formData: FormData) => Promise<void>;
  /**
   * Super-admin QA plan preview. When both are provided (super-admins
   * only), the dropdown renders a "Preview plan" section that pins the
   * admin's effective plan to any tier so they can walk each plan's
   * gated experience. `previewPlan` is the currently-pinned tier (or
   * null = the default 'practice' super-admin experience).
   */
  previewPlan?: Plan | null;
  setPreviewPlanAction?: (formData: FormData) => Promise<void>;
};

// `maxH` is the space actually left between the bottom of the avatar button
// and the bottom of the viewport. It has to be measured rather than written
// as `calc(100vh - 32px)`: the menu is positioned at `top`, so a cap phrased
// against the full viewport height overhangs the bottom edge by `top`, and a
// position:fixed overhang can never be scrolled into view.
type AnchorRect = { top: number; right: number; maxH: number };

// Plan tiers for the super-admin preview switcher, cheapest → richest.
// The hint is the human-readable gist of what each tier unlocks, so a
// QA pass can sanity-check the gating matches the plan at a glance.
const PLAN_PREVIEW_META: { plan: Plan; label: string; hint: string }[] = [
  { plan: "free", label: "Free", hint: "No paid features (expired / trial)" },
  { plan: "filer", label: "Filer", hint: "W-2 forecast · Bella (Haiku)" },
  { plan: "solo", label: "Solo", hint: "1099 forecast · bank sync · CSV" },
  { plan: "studio", label: "Studio", hint: "Multi-company · team · multi-state" },
  { plan: "scale", label: "Scale", hint: "Priority · audit · white-label · API" },
  { plan: "practice", label: "Practice", hint: "Everything · preparer center" },
];

// Portal labels for the switcher. We deliberately don't render the
// destination hostname here anymore, the server action handling the
// form (setActivePlatform) decides whether to send the user to the
// subdomain or fall back to the path-based admin shell on the consumer
// host, depending on NEXT_PUBLIC_*_HOST_LIVE env flags. The hint is
// the human-readable purpose of each portal, not its URL.
const PLATFORM_META: Record<Platform, { label: string; hint: string }> = {
  user: {
    label: "Consumer app",
    hint: "Dashboard, forecast, expenses, Bella",
  },
  enterprise: {
    label: "Enterprise",
    hint: "Firms operations + client list",
  },
  hq: {
    label: "HQ",
    hint: "Super-admin operations",
  },
};

export function UserMenu({
  email,
  fullName,
  avatarUrl,
  adminMode = false,
  isSuperAdmin = false,
  currentPlatform = "user",
  setPlatformAction,
  submitFeedbackAction,
  previewPlan = null,
  setPreviewPlanAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration: createPortal needs document, only available post-mount
    setMounted(true);
  }, []);

  // Position the dropdown under the avatar, anchored to the viewport. We
  // recompute on open and on viewport change so it stays glued to the
  // button when the user resizes / rotates / scrolls a foldable open.
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    function recompute() {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const top = r.bottom + 8;
      // visualViewport is the honest number inside a mobile WebView, where
      // innerHeight can include chrome the user cannot see.
      const vh = window.visualViewport?.height ?? window.innerHeight;
      setAnchor({
        top,
        right: window.innerWidth - r.right,
        // 12px breathing room at the bottom; floor so a very short viewport
        // still yields a usable (scrollable) menu rather than a sliver.
        maxH: Math.max(200, vh - top - 12),
      });
    }
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const initials = (fullName || email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const showSwitcher = isSuperAdmin && setPlatformAction;
  const showFeedback = Boolean(submitFeedbackAction);
  const showPlanPreview = isSuperAdmin && Boolean(setPreviewPlanAction);
  // Unset override = the default 'practice' super-admin experience.
  const effectivePreview: Plan = previewPlan ?? "practice";

  const dropdown =
    open && anchor && mounted
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            // Portaled to <body> so we escape the AppHeader's stacking
            // context (the header sets `isolation: isolate` for its gold
            // sweep, which previously trapped a z-50 dropdown behind the
            // page heading). max-w guarantees we never overflow the
            // viewport on narrow / foldable devices.
            style={{
              // Anchored under the avatar button on lg+ (the user's
              // visual expectation: dropdown drops down from where it
              // was clicked). On phone (<sm) we still center because
              // a corner-anchored sheet is awkward to reach with a
              // thumb, but on desktop the previous "centered on
              // viewport" treatment was straight-up weird ("opens in
              // the middle of the screen", May 25 feedback). anchor
              // already carries the button rect; just use it.
              position: "fixed",
              top: anchor.top,
              right: anchor.right,
              zIndex: 9999,
              maxWidth: "calc(100vw - 16px)",
              // Measured cap (see AnchorRect), minus whatever the device
              // reserves at the bottom for a gesture bar / home indicator.
              maxHeight: `calc(${anchor.maxH}px - max(var(--safe-bottom, 0px), env(safe-area-inset-bottom, 0px)))`,
            }}
            // Column layout: identity header and the sign-out footer are
            // fixed rails, only the middle scrolls. Sign out / Switch
            // accounts are terminal actions and must never be the thing that
            // falls off the bottom of a small screen.
            className="w-72 card card-opaque p-2 shadow-2xl flex flex-col min-h-0"
          >
            <div className="shrink-0 px-3 py-2.5 border-b border-forest-100">
              <div className="text-sm font-medium text-forest-900 truncate">
                {fullName || "Your account"}
              </div>
              {email ? (
                <div className="text-xs text-ink-muted truncate">{email}</div>
              ) : null}
              {isSuperAdmin ? (
                <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-gold-700 font-medium">
                  Super-admin
                </div>
              ) : null}
            </div>

            {/* Everything between the identity header and the sign-out rail
                scrolls. overscroll-contain keeps a flick inside the menu
                instead of handing it to the page behind. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">

            {/* Theme toggle, Light / Dark. Persisted in localStorage;
                DarkThemeMount picks up the change without a reload. */}
            <ThemeToggle />

            {/* Platform switcher (super-admins only). Each option is a
                single-button form posting to setActivePlatform with the
                target platform; the action persists the choice and
                redirects to that platform's landing page. */}
            {showSwitcher ? (
              <MenuSection label="Switch portal">
                <ul className="grid gap-1">
                  {(Object.keys(PLATFORM_META) as Platform[]).map((p) => {
                    const meta = PLATFORM_META[p];
                    const isCurrent = currentPlatform === p;
                    return (
                      <li key={p}>
                        <form
                          action={setPlatformAction}
                          onSubmit={() => setOpen(false)}
                        >
                          <input type="hidden" name="platform" value={p} />
                          <button
                            type="submit"
                            disabled={isCurrent}
                            className={
                              "w-full text-left rounded-lg px-3 py-2 text-sm flex items-center gap-2 group " +
                              (isCurrent
                                ? "bg-cream text-forest-900 cursor-default"
                                : "text-forest-800 hover:bg-cream")
                            }
                          >
                            <span className="flex-1 min-w-0">
                              <span className="block font-medium">
                                {meta.label}
                              </span>
                              <span className="block text-[11px] text-ink-muted">
                                {meta.hint}
                              </span>
                            </span>
                            {isCurrent ? (
                              <span className="text-[10px] uppercase tracking-[0.18em] text-gold-700 font-medium shrink-0">
                                Current
                              </span>
                            ) : (
                              <span
                                aria-hidden="true"
                                className="text-ink-muted group-hover:text-forest-800 shrink-0"
                              >
                                →
                              </span>
                            )}
                          </button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </MenuSection>
            ) : null}

            {/* Plan preview (super-admins only). Pins the admin's
                effective plan to any tier so they can walk each plan's
                gated experience and confirm the gating matches the
                plan. Server-enforced via profiles.preview_plan →
                getActivePlan, so it flows through every gate. */}
            {showPlanPreview ? (
              <MenuSection label="Preview plan · QA">
                <div className="px-2 pb-2 pt-0.5 text-[11px] text-ink-muted leading-snug">
                  Pin your plan to walk each tier&rsquo;s gated view.
                </div>
                <ul className="grid gap-1">
                  {PLAN_PREVIEW_META.map(({ plan, label, hint }) => {
                    const isCurrent = effectivePreview === plan;
                    return (
                      <li key={plan}>
                        <form
                          action={setPreviewPlanAction}
                          onSubmit={() => setOpen(false)}
                        >
                          <input type="hidden" name="plan" value={plan} />
                          <button
                            type="submit"
                            disabled={isCurrent}
                            className={
                              "w-full text-left rounded-lg px-3 py-2 text-sm flex items-center gap-2 group " +
                              (isCurrent
                                ? "bg-cream text-forest-900 cursor-default"
                                : "text-forest-800 hover:bg-cream")
                            }
                          >
                            <span className="flex-1 min-w-0">
                              <span className="block font-medium">{label}</span>
                              <span className="block text-[11px] text-ink-muted">
                                {hint}
                              </span>
                            </span>
                            {isCurrent ? (
                              <span className="text-[10px] uppercase tracking-[0.18em] text-gold-700 font-medium shrink-0">
                                Viewing
                              </span>
                            ) : (
                              <span
                                aria-hidden="true"
                                className="text-ink-muted group-hover:text-forest-800 shrink-0"
                              >
                                →
                              </span>
                            )}
                          </button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </MenuSection>
            ) : null}

            <ul className="py-1.5">
              {adminMode ? (
                <>
                  <MenuLink href="/" onClick={() => setOpen(false)}>
                    Admin home
                  </MenuLink>
                  <MenuLink href="/firms" onClick={() => setOpen(false)}>
                    Tax-prep firms
                  </MenuLink>
                  <MenuLink href="/feedback" onClick={() => setOpen(false)}>
                    Feedback queue
                  </MenuLink>
                  <li>
                    <a
                      href="https://taxottic.com/dashboard"
                      className="block rounded-lg px-3 py-2 text-sm text-forest-800 hover:bg-cream"
                      onClick={() => setOpen(false)}
                    >
                      Customer app &rarr;
                    </a>
                  </li>
                </>
              ) : (
                <>
                  <MenuLink href="/dashboard" onClick={() => setOpen(false)}>
                    Dashboard
                  </MenuLink>
                  <MenuLink
                    href="/onboarding/tax-profile?next=/dashboard"
                    onClick={() => setOpen(false)}
                  >
                    Tax profile
                  </MenuLink>
                  <MenuLink href="/goals" onClick={() => setOpen(false)}>
                    Goals
                  </MenuLink>
                  <MenuLink href="/reminders" onClick={() => setOpen(false)}>
                    Reminders
                  </MenuLink>
                  {/* 3.1.1: billing/plan management is web-only, hidden
                      in the native app (Stripe, not Apple IAP). */}
                  <WebOnly>
                    <MenuLink href="/billing" onClick={() => setOpen(false)}>
                      Billing &amp; plan
                    </MenuLink>
                  </WebOnly>
                  <MenuLink
                    href="/settings/security"
                    onClick={() => setOpen(false)}
                  >
                    Security &amp; passkeys
                  </MenuLink>
                  <MenuLink
                    href="/settings/data"
                    onClick={() => setOpen(false)}
                  >
                    Your data
                  </MenuLink>
                  <MenuLink
                    href="/settings/recycle-bin"
                    onClick={() => setOpen(false)}
                  >
                    Recycle bin
                  </MenuLink>
                </>
              )}
            </ul>

            {/* Send feedback - replaces the standalone FAB. The modal
                opens when this is clicked; the dropdown closes
                simultaneously so the modal isn't behind the menu. */}
            {showFeedback ? (
              <div className="border-t border-forest-100 pt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setFeedbackOpen(true);
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 text-sm text-forest-800 hover:bg-cream flex items-center gap-2"
                >
                  <svg
                    viewBox="0 0 20 20"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 4 L17 4 L17 14 L11 14 L7 17 L7 14 L3 14 Z" />
                  </svg>
                  Send feedback
                </button>
              </div>
            ) : null}

            <div className="border-t border-forest-100 pt-1.5">
              {/* Refresh app, always-available escape hatch when the
                  (scrollable region, unlike the two terminal actions
                  pinned to the rail below)
                  WebView (Capacitor) or PWA is serving stale cached
                  content. Unregisters all service workers, deletes
                  every cache, then force-reloads from network. Users
                  on the phone app reported "I can't see the latest
                  changes" because a normal Vercel deploy doesn't
                  always bump the SW version → the in-app "New
                  version" toast never fires. This button is the
                  fallback they can hit any time. */}
              <button
                type="button"
                onClick={async () => {
                  setOpen(false);
                  try {
                    if (
                      typeof navigator !== "undefined" &&
                      "serviceWorker" in navigator
                    ) {
                      const regs = await navigator.serviceWorker.getRegistrations();
                      await Promise.all(regs.map((r) => r.unregister()));
                    }
                    if (typeof caches !== "undefined") {
                      const keys = await caches.keys();
                      await Promise.all(keys.map((k) => caches.delete(k)));
                    }
                  } catch {
                    /* best-effort; reload below either way */
                  }
                  // Cache-bust the reload so the WebView's own
                  // network cache also discards the entry. The query
                  // string is dropped by the router on the next nav.
                  const sep = window.location.href.includes("?") ? "&" : "?";
                  window.location.href =
                    window.location.href + sep + "_refresh=" + Date.now();
                }}
                className="w-full text-left rounded-lg px-3 py-2 text-sm text-forest-800 hover:bg-cream flex items-center gap-2"
                title="Clear cached content and load the latest version"
              >
                <svg
                  viewBox="0 0 20 20"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 10 a7 7 0 0 1 12-5 L17 7 M17 3 L17 7 L13 7" />
                  <path d="M17 10 a7 7 0 0 1 -12 5 L3 13 M3 17 L3 13 L7 13" />
                </svg>
                Refresh app
              </button>
            </div>

            {/* end of the scrollable region */}
            </div>

            {/* Terminal actions, pinned. These are the two things a user
                comes to this menu for when something is wrong, so they sit
                outside the scroll area and stay on screen no matter how many
                segments are open above. 44px minimum tap target. */}
            <div className="shrink-0 border-t border-forest-100 pt-1.5">
              {/* Switch accounts, clears the current session AND tells the
                  login page to force Google/Microsoft's account picker (via
                  ?force_picker=1, which the login page translates into
                  prompt=select_account on the OAuth call). Without this,
                  a user who's signed into multiple Google accounts in
                  Chrome gets silently re-authenticated as whichever one
                  the provider considers "default", which is exactly the
                  "it auto-signs me into an account I don't want" complaint. */}
              <form action="/auth/signout" method="post">
                <input
                  type="hidden"
                  name="next"
                  value="/login?force_picker=1"
                />
                <button
                  type="submit"
                  className="w-full min-h-11 text-left rounded-lg px-3 py-2 text-sm text-forest-800 hover:bg-cream flex items-center gap-2"
                >
                  <svg
                    viewBox="0 0 20 20"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 7 L16 7 M12 3 L16 7 L12 11" />
                    <path d="M16 13 L4 13 M8 9 L4 13 L8 17" />
                  </svg>
                  Switch accounts
                </button>
              </form>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="w-full min-h-11 text-left rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-cream hover:text-forest-900"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="size-9 rounded-full overflow-hidden border border-forest-200 bg-white shadow-sm hover:shadow transition-shadow grid place-items-center text-sm font-medium text-forest-800 select-none"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span>{initials || "·"}</span>
        )}
      </button>
      {dropdown}
      {/* The feedback modal lives at the UserMenu level so the
          dropdown can open/close it without prop-drilling state up to
          AppHeader. Renders nothing when feedbackOpen is false. */}
      {submitFeedbackAction ? (
        <FeedbackModal
          open={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          submitAction={submitFeedbackAction}
        />
      ) : null}
    </div>
  );
}

/**
 * A collapsed-by-default segment of the account menu.
 *
 * Reported by the owner from a Galaxy Z Fold5 cover screen (~344x882 CSS px):
 * a super-admin's menu carries nine extra rows across "Switch portal" and
 * "Preview plan", which pushed Sign out and Switch accounts past the bottom
 * of the screen. These are occasional-use segments, so they now start closed
 * and the menu opens at a length that fits any phone.
 *
 * Native <details>/<summary>: no JS, keyboard and screen-reader behaviour for
 * free, and the same disclosure language as the Income / Expenses month
 * accordions. The chevron is stroked with currentColor because authenticated
 * routes are dark-themed and raw hex is not remapped by the theme.
 */
function MenuSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group px-1 py-1 border-b border-forest-100">
      <summary className="flex min-h-11 items-center gap-2 rounded-lg px-2 cursor-pointer select-none list-none hover:bg-cream">
        <svg
          className="size-3.5 shrink-0 text-gold-700 transition-transform group-open:rotate-90"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 5l6 5-6 5" />
        </svg>
        <span className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
          {label}
        </span>
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}

function MenuLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onClick}
        className="block rounded-lg px-3 py-2 text-sm text-forest-800 hover:bg-cream"
      >
        {children}
      </Link>
    </li>
  );
}
