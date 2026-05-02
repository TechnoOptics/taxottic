"use client";

import { useEffect } from "react";

/**
 * Tiny client-only effect that toggles a body class when the user
 * scrolls down so the fixed app-header can shrink (CSS-only). At the
 * top of the page the header is full-size; once we've scrolled past
 * a small threshold it shrinks. Mobile-only - desktop has plenty of
 * vertical room. Not a JS animation; we just toggle the class and
 * let CSS transitions handle the visual.
 */
export function HeaderScrollHider() {
  useEffect(() => {
    let lastY = 0;
    let ticking = false;
    const THRESHOLD = 32;

    function update() {
      const y = window.scrollY;
      const body = document.body;
      // Add `app-scrolled` once we're past the threshold; remove
      // when we're back near the top. Hysteresis avoids flicker.
      if (y > THRESHOLD && !body.classList.contains("app-scrolled")) {
        body.classList.add("app-scrolled");
      } else if (y < THRESHOLD - 4 && body.classList.contains("app-scrolled")) {
        body.classList.remove("app-scrolled");
      }
      lastY = y;
      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.body.classList.remove("app-scrolled");
    };
  }, []);

  return null;
}
