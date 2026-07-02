"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OutstandingItem } from "@/lib/tasks/outstanding";

type Props = {
  count: number;
  items: OutstandingItem[];
};

type AnchorRect = { top: number; right: number };

const KIND_ICON: Record<OutstandingItem["kind"], string> = {
  trip: "🚗",
  csv_transaction: "🧾",
  bank_transaction: "🏦",
};

/**
 * Header notification bell — the durable, always-truthful indicator of
 * outstanding tasks (unclassified drives + transactions awaiting a
 * category). Unlike the popup/banner, the bell is never dismissible:
 * it always reflects the live count so the user has one place they can
 * trust. Same portal/anchor pattern as UserMenu so it escapes the
 * header's stacking context identically.
 */
export function OutstandingTasksBell({ count, items }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration: createPortal needs document
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    function recompute() {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right });
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

  const dropdown =
    open && anchor && mounted
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              top: anchor.top,
              right: anchor.right,
              zIndex: 9999,
              maxWidth: "calc(100vw - 16px)",
              maxHeight: "calc(100vh - 32px)",
              overflowY: "auto",
            }}
            className="w-80 card card-opaque p-2 shadow-2xl"
          >
            <div className="px-3 py-2.5 border-b border-forest-100">
              <div className="text-sm font-medium text-forest-900">
                Needs your review
              </div>
              <div className="text-xs text-ink-muted">
                {count} item{count === 1 ? "" : "s"} waiting on a quick call
              </div>
            </div>
            <div className="py-1">
              {items.map((it) => (
                <Link
                  key={`${it.kind}:${it.id}`}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 rounded-lg px-3 py-2 hover:bg-forest-50/60 transition-colors"
                >
                  <span aria-hidden="true" className="text-base leading-none mt-0.5">
                    {KIND_ICON[it.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-forest-900 truncate">
                      {it.title}
                    </span>
                    <span className="block text-[11px] text-ink-muted truncate">
                      {it.subtitle}
                    </span>
                  </span>
                </Link>
              ))}
              {count > items.length ? (
                <div className="px-3 py-2 text-[11px] text-ink-muted">
                  +{count - items.length} more
                </div>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          count > 0
            ? `${count} outstanding item${count === 1 ? "" : "s"} need review`
            : "Notifications"
        }
        aria-expanded={open}
        className="relative inline-flex size-9 items-center justify-center rounded-full text-cream/85 hover:text-cream hover:bg-white/10 transition-colors"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          🔔
        </span>
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-semibold leading-none text-forest-950"
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
      {dropdown}
    </>
  );
}
