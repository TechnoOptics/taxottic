"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  email: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
  // When true, swap the customer-app navigation list for an
  // admin-only short list (sign out + jump back to taxottic.com).
  // Used on hq.taxottic.com so super-admins don't see broken links
  // to /dashboard, /goals, etc. that don't exist on the admin host.
  adminMode?: boolean;
};

type AnchorRect = { top: number; right: number };

export function UserMenu({ email, fullName, avatarUrl, adminMode = false }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [mounted, setMounted] = useState(false);
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
            className="w-64 card p-2 shadow-2xl"
          >
            <div className="px-3 py-2.5 border-b border-forest-100">
              <div className="text-sm font-medium text-forest-900 truncate">
                {fullName || "Your account"}
              </div>
              {email ? (
                <div className="text-xs text-ink-muted truncate">{email}</div>
              ) : null}
            </div>
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
                    Feedback
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
                </>
              )}
            </ul>
            <div className="border-t border-forest-100 pt-1.5">
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
