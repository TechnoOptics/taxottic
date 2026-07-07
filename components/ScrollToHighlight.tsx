"use client";

import { useEffect } from "react";

/**
 * Scrolls the element with `targetId` into view (centered) on mount.
 * Server pages render this next to a highlighted row so a deep link
 * like ?highlight=<id> actually LANDS the user on the item — instead
 * of dumping them at the top of a list to hunt for it. Renders nothing.
 */
export function ScrollToHighlight({ targetId }: { targetId: string }) {
  useEffect(() => {
    // Rendered after the target in the same server payload, so the
    // element exists by the time this effect runs; rAF covers layout.
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(targetId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [targetId]);
  return null;
}
