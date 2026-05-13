"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FeedbackModal } from "./FeedbackModal";

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
};

type AnchorRect = { top: number; right: number };

// Portal labels for the switcher. We deliberately don't render the
// destination hostname here anymore — the server action handling the
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
}: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
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
      setAnchor({
        top: r.bottom + 8,
        right: window.innerWidth - r.right,
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
              position: "fixed",
              top: anchor.top,
              right: Math.max(anchor.right, 8),
              zIndex: 9999,
              maxWidth: "calc(100vw - 16px)",
            }}
            className="w-72 card p-2 shadow-2xl"
          >
            <div className="px-3 py-2.5 border-b border-forest-100">
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

            {/* Platform switcher (super-admins only). Each option is a
                single-button form posting to setActivePlatform with the
                target platform; the action persists the choice and
                redirects to that platform's landing page. */}
            {showSwitcher ? (
              <div className="px-1 py-2 border-b border-forest-100">
                <div className="px-2 pt-1 pb-2 text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                  Switch portal
                </div>
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
              </div>
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
                  <MenuLink href="/billing" onClick={() => setOpen(false)}>
                    Billing &amp; plan
                  </MenuLink>
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
              {/* Switch accounts — clears the current session AND tells the
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
                    <path d="M4 7 L16 7 M12 3 L16 7 L12 11" />
                    <path d="M16 13 L4 13 M8 9 L4 13 L8 17" />
                  </svg>
                  Switch accounts
                </button>
              </form>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="w-full text-left rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-cream hover:text-forest-900"
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
