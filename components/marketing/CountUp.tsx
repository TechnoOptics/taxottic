"use client";
import { useEffect } from "react";

/**
 * The live figure settles from 0 to its value once, over 500 ms, in the
 * tabular mono face so the width never changes. The server renders the
 * final value, so a reader with reduced motion or no JS sees it at once.
 */
export function CountUp({ id, cents }: { id: string; cents: number }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 500);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt.format(Math.round((cents / 100) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id, cents]);
  return null;
}
