"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Shared "shareable calculator" plumbing, used by every calculator:
 *
 * - useCalcShare keeps the URL query string in sync with the current
 *   inputs (via history.replaceState, no navigation / server round-trip),
 *   so the address bar always reproduces the calculation and a shared
 *   link opens a pre-filled, already-computed calculator with a matching
 *   OG preview. It also returns a `share()` that uses the native share
 *   sheet on mobile and falls back to copy-to-clipboard on desktop.
 * - ShareButton is the pill that calls it.
 */
export function useCalcShare(
  params: Record<string, string | undefined>,
  buildText: () => string,
): { share: () => Promise<void>; copied: boolean } {
  const [copied, setCopied] = useState(false);

  // Stringify once so the memo/effect below depend on a stable primitive
  // rather than the fresh `params` object identity each render.
  const paramsKey = JSON.stringify(params);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") p.set(k, v);
    }
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on the stringified key, not the object identity
  }, [paramsKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [query]);

  async function share() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ text: buildText(), url });
        return;
      }
    } catch {
      /* user cancelled the native sheet, fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked, nothing more we can do gracefully */
    }
  }

  return { share, copied };
}

export function ShareButton({
  onShare,
  copied,
}: {
  onShare: () => void;
  copied: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onShare}
      className="shrink-0 -mt-1 inline-flex items-center gap-1.5 rounded-full border border-forest-100 px-3 py-1.5 text-xs font-medium text-forest-800 hover:bg-cream hover:border-gold-300 transition-colors"
      aria-label="Share this result"
    >
      {copied ? (
        "Link copied"
      ) : (
        <>
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
          </svg>
          Share
        </>
      )}
    </button>
  );
}
