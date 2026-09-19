"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useIsNativeApp } from "@/components/MobileOnly";
import { tabBarLinks } from "@/lib/today/tab-bar";
import { CalendarIcon, CarIcon, ReceiptIcon, ChartIcon, MenuIcon } from "@/components/ui/Icons";

const ICONS = { today: CalendarIcon, drives: CarIcon, money: ReceiptIcon, forecast: ChartIcon } as const;

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
  useEffect(() => {
    if (!show) return;
    document.documentElement.dataset.tabBar = "1";
    return () => {
      delete document.documentElement.dataset.tabBar;
    };
  }, [show]);
  if (!show) return null;
  const links = tabBarLinks({ companies, storedMode, pathname });
  return (
    <nav className="tab-bar lg:hidden" aria-label="Main">
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
    </nav>
  );
}
