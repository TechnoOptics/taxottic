"use client";

import { useEffect } from "react";

/** While the navy app header is on screen, the status bar is navy too. */
export function NavyBar() {
  useEffect(() => {
    document.documentElement.dataset.bar = "navy";
    return () => {
      delete document.documentElement.dataset.bar;
    };
  }, []);
  return null;
}
