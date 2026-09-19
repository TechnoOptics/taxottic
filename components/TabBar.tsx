"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useIsNativeApp } from "@/components/MobileOnly";
import { tabBarLinks } from "@/lib/today/tab-bar";
import { CalendarIcon, CarIcon, ReceiptIcon, ChartIcon, MenuIcon } from "@/components/ui/Icons";

const ICONS = { today: CalendarIcon, drives: CarIcon, money: ReceiptIcon, forecast: ChartIcon } as const;

/** The widths the bar shows at, matching the nav's own `lg:hidden`. */
const NARROW = "(max-width: 1023px)";

/**
 * The phone tab bar, native shells below lg only (spec 4.4). "More" opens
 * the same rail sheet LeftRailMobile owns, by event, so the sheet stays in
 * one place. While mounted it sets html[data-tab-bar] so page content
 * keeps clear of it.
 */
export function TabBar({ companies, storedMode, forceNative = false }: { companies: { public_id: string; role: string }[]; storedMode: "business" | "personal" | null; forceNative?: boolean }) {
  const native = useIsNativeApp();
  const pathname = usePathname() ?? "/";
  const show = forceNative || native === true;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration: createPortal needs document, which only exists post-mount
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!show) return;
    // The clearance the bar needs only exists where the bar itself shows.
    // Above lg the nav is hidden by `lg:hidden` but the attribute would
    // still be set, so an iPad reserved 56px of padding under content for
    // a bar that was never painted. Track the query instead of assuming.
    const mq = window.matchMedia(NARROW);
    const sync = () => {
      if (mq.matches) document.documentElement.dataset.tabBar = "1";
      else delete document.documentElement.dataset.tabBar;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      delete document.documentElement.dataset.tabBar;
    };
  }, [show]);
  if (!show || !mounted) return null;
  const links = tabBarLinks({ companies, storedMode, pathname });
  // Portal to <body>, same reason as LeftRailMobile's FAB: AppHeader mounts
  // this inside `.app-header`, and that element carries backdrop-filter,
  // overflow-x: clip and isolation: isolate. Each of those makes the header
  // the containing block for a `position: fixed` descendant, so the bar's
  // `bottom: 0` resolved against the ~52px header and the bar painted
  // clipped under the top bar instead of on the viewport's bottom edge.
  // On <body> there is no such ancestor and `fixed` means the viewport again.
  return createPortal(
    <nav className="tab-bar lg:hidden" aria-label="Tab bar">
      {links.map((l) => {
        const Icon = ICONS[l.key];
        return (
          <Link key={l.key} href={l.href} className="tab-bar-item" aria-current={l.current ? "page" : undefined}>
            <Icon className="size-5" />
            <span>{l.label}</span>
          </Link>
        );
      })}
      <button type="button" className="tab-bar-item" onClick={() => window.dispatchEvent(new Event("taxottic:open-rail"))}>
        <MenuIcon className="size-5" />
        <span>More</span>
      </button>
    </nav>,
    document.body,
  );
}
