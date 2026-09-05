"use client";
import { useEffect } from "react";

/**
 * Two behaviours for the home page's spine, and nothing else animates.
 *
 * On load the rail draws left to right and the marker and its label land
 * (CSS transitions keyed on .is-drawing then .is-drawn). As the reader
 * scrolls, the fill moves to the date of the moment crossing the
 * viewport's centre and returns to today above the sequence; the marker
 * never moves, so the distance between a moment and today is visible.
 * Under prefers-reduced-motion the final state renders immediately and
 * the fill still follows the scroll without transition (see globals.css).
 */
export function YearSpineMotion({ spineId, todayFill }: { spineId: string; todayFill: number }) {
  useEffect(() => {
    const spine = document.getElementById(spineId);
    if (!spine) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf1 = 0;
    let raf2 = 0;

    if (reduce) {
      spine.classList.add("is-drawn");
    } else {
      spine.classList.add("is-drawing");
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => spine.classList.add("is-drawn"));
      });
    }

    const moments = Array.from(document.querySelectorAll<HTMLElement>("[data-moment-at]"));
    const setFill = (f: number) => spine.style.setProperty("--spine-fill", `${(f * 100).toFixed(2)}%`);
    const update = () => {
      const mid = window.innerHeight / 2;
      const active = moments.find((m) => {
        const r = m.getBoundingClientRect();
        return r.top <= mid && r.bottom > mid;
      });
      setFill(active ? Number(active.dataset.momentAt) : todayFill);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [spineId, todayFill]);
  return null;
}
