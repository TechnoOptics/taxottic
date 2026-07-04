"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// StudioFamilyFAB, a floating cross-product launcher that lives in
// the bottom-LEFT corner (sibling to the Bella FAB on the bottom-
// right). Clicking it opens a card that lists the Techno Optics
// family of products with one-click jumps to each.
//
// Why this exists:
//   1. The May 2026 third-party audit recommended a "Made by Techno
//      Optics" chip with a link to the family on every product, so
//      "cross-pollination strengthens both brands." This is the
//      richer, more interactive version of that chip.
//   2. The user (founder of Techno Optics) asked for design cohesion
//      with Advottic. Advottic's signature visual element is its
//      sticky forest header + the Bella floating button; mirroring
//      that with a SECOND floating button in the same style, but
//      for cross-product nav, makes the relationship between
//      Taxottic, Advottic, and the studio site visible without a
//      hard nav bar refactor.
//
// Style:
//   - Same animated gold conic-gradient ring as the Bella FAB (uses
//     the .bella-fab class chain in globals.css), just inverted for
//     bottom-LEFT positioning.
//   - The flyout card uses the .card style + the gold-shine accent.
//   - Bottom-left (not bottom-right) so it never collides with Bella.
//
// Behavior:
//   - Click the FAB → flyout opens above it.
//   - Click outside / Escape → close.
//   - Each item is an <a> with `target="_blank"` because the sister
//     products are separate domains; users should keep their current
//     session open.

type Product = {
  name: string;
  href: string;
  tagline: string;
  current?: boolean;
};

// Source of truth: the Techno Optics family. Update here when a new
// product ships and every Taxottic page picks it up automatically.
// Keep `current: true` on the row representing THIS product so it
// renders with a "You are here" indicator instead of opening.
const FAMILY: Product[] = [
  {
    name: "Taxottic",
    href: "https://taxottic.com",
    tagline: "A calmer way to handle your taxes.",
    current: true,
  },
  {
    name: "Advottic",
    href: "https://advottic.com",
    tagline: "Walk into court prepared.",
  },
  {
    name: "Techno Optics",
    href: "https://technooptics.com",
    tagline: "The studio behind every product.",
  },
];

export function StudioFamilyFAB() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Outside-click and Escape to close. Same pattern as UserMenu.
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

  const flyout =
    open && mounted
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Techno Optics product family"
            // Portaled to body so we escape any stacking-context trap
            // from the FAB's parent. Positioned absolute over the
            // bottom-left of the viewport, above the FAB itself.
            className="card p-3 shadow-2xl"
            style={{
              position: "fixed",
              left: "1rem",
              bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))",
              width: "min(20rem, calc(100vw - 2rem))",
              zIndex: 9998,
            }}
          >
            <div className="px-2 pt-1 pb-2 border-b border-forest-100">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                Made by{" "}
                <a
                  href="https://technooptics.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-forest-900"
                >
                  Techno Optics
                </a>
              </div>
              <div className="text-xs text-ink-soft mt-1 leading-relaxed">
                One calm, careful studio. Many calm, careful products.
              </div>
            </div>
            <ul className="py-1 grid gap-0.5">
              {FAMILY.map((p) => (
                <li key={p.name}>
                  {p.current ? (
                    <div
                      className="block rounded-lg px-3 py-2 text-sm bg-cream/80 cursor-default"
                      aria-current="page"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="display text-forest-900">{p.name}</span>
                        <span className="text-[10px] uppercase tracking-[0.18em] text-gold-700 shrink-0">
                          You are here
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-muted mt-0.5">
                        {p.tagline}
                      </div>
                    </div>
                  ) : (
                    <a
                      href={p.href}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg px-3 py-2 text-sm text-forest-800 hover:bg-cream group"
                      onClick={() => setOpen(false)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="display text-forest-900 group-hover:text-forest-900">
                          {p.name}
                        </span>
                        <span
                          aria-hidden="true"
                          className="text-ink-muted group-hover:text-forest-800 transition-colors"
                        >
                          ↗
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-muted mt-0.5">
                        {p.tagline}
                      </div>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {/* Same .bella-fab visual chain, animated gold conic ring around
          a forest core. We're not USING the BellaFAB component because
          this is a different action (open the family flyout, not chat),
          but the CSS class makes the two FABs visually a matching
          pair so the page reads as "two sister buttons, two siblings". */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Other Techno Optics products"
        aria-haspopup="menu"
        aria-expanded={open}
        // bella-fab class provides the conic gold-ring animation;
        // size-12 keeps the button slightly smaller than Bella (size-14)
        // so it visually defers to the primary action on the page.
        className="bella-fab size-12 rounded-full grid place-items-center cursor-pointer"
        style={{
          left: "1rem",
          bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
          right: "auto",
          // z below Bella so when both are present, Bella wins focus
          // order on tap.
          zIndex: 39,
        }}
      >
        {/* Concentric ring icon evokes "family of products" without
            using a literal grid icon. Stroke is the same gold gradient
            Bella uses via its inner text fill. */}
        <span className="bella-fab-inner display text-xl leading-none select-none">
          ⋄
        </span>
      </button>
      {flyout}
    </>
  );
}
