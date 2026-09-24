"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BellIcon } from "@/components/ui/Icons";

type Props = {
  count: number;
  firstHref: string;
};

// Separate dismissal key from the popup's, a user can close the popup
// and still see this slim reminder (or vice versa); each surface has
// its own per-session memory so dismissing one doesn't silently hide
// the other.
const DISMISS_KEY = "taxottic.outstanding.banner.dismissed";

/**
 * Slim, persistent-but-quiet reminder rendered globally under the app
 * header when items are outstanding. Dismissible for the session (the
 * bell keeps the live count regardless); reappears on the next fresh
 * session, same as the popup.
 *
 * Colour comes from the accent tokens (accent-2 at 10% for the fill, 40%
 * for the border), the same formula the trial banner's "ending soon"
 * state uses, so one set of classes reads in both themes. The previous
 * `bg-gold-50/70` had no dark twin and sat under text the dark theme had
 * flipped to cream: 2.0:1, a beige slab on the first authenticated
 * screen. Measured in components/OutstandingTasksBanner.ct.spec.tsx.
 *
 * Layout: on a phone the bell and the two controls share the first row
 * and the sentence spans the width beneath them; from `sm` up all four
 * sit on one line. The earlier flex row gave the sentence `flex-1
 * min-w-0` between three auto-width siblings, so on a 344px cover
 * screen it got 152px (54% of the banner) and wrapped to four lines
 * beside a blank gap. DOM order stays bell, sentence, link, dismiss.
 */
export function OutstandingTasksBanner({ count, firstHref }: Props) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let wasDismissed = false;
    try {
      wasDismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* private mode, treat as not dismissed */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only sessionStorage; must run after mount
    setDismissed(wasDismissed);
  }, []);

  if (count <= 0 || dismissed) return null;

  return (
    <div className="grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-1 rounded-xl border border-accent-2/40 bg-accent-2/10 px-4 py-2.5 text-xs text-forest-900">
      <BellIcon className="size-4 shrink-0" />
      <span className="order-last col-span-3 sm:order-none sm:col-span-1 min-w-0">
        {count} item{count === 1 ? "" : "s"} need{count === 1 ? "s" : ""} a
        business-or-personal call before they count toward your deduction.
      </span>
      <Link
        href={firstHref}
        className="justify-self-end font-medium text-forest-700 hover:text-forest-900 underline underline-offset-2"
      >
        Review now
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* private mode, reappears next reload, acceptable */
          }
        }}
        className="text-ink-muted hover:text-forest-900"
      >
        ×
      </button>
    </div>
  );
}
