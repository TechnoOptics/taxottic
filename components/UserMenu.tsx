"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Props = {
  email: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
};

export function UserMenu({ email, fullName, avatarUrl }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  return (
    <div className="relative" ref={ref}>
      <button
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

      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 card p-2 shadow-xl z-30"
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
            <MenuLink href="/dashboard" onClick={() => setOpen(false)}>
              Dashboard
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
            <MenuLink href="/settings/security" onClick={() => setOpen(false)}>
              Security &amp; passkeys
            </MenuLink>
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
        </div>
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
