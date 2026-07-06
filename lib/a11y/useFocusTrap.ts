"use client";

import { useEffect, type RefObject } from "react";

/**
 * Trap keyboard focus inside a container while it's active (a modal/dialog).
 * Keeps Tab / Shift+Tab cycling within the container's focusable elements so
 * keyboard and screen-reader users can't wander into the page behind the
 * backdrop, and restores focus to whatever was focused before on deactivate.
 *
 * Shared primitive so every role="dialog" surface can meet the ARIA
 * expectation without re-implementing the trap (WelcomeTour has its own inline
 * version; new modals should use this).
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(ref, open);
 *   return open ? <div ref={ref} role="dialog" aria-modal="true">…</div> : null;
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // Move focus into the dialog on open (first focusable, else the container).
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    const initial = focusables();
    if (initial.length > 0) initial[0].focus();
    else container.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger on close.
      previouslyFocused?.focus?.();
    };
  }, [ref, active]);
}
