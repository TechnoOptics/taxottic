import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import { MarketingNav } from "@/components/MarketingNav";

/**
 * The marketing header on paper. Fixed rather than sticky: html/body
 * carry overflow-x: clip for the WebView, which disables position:
 * sticky, so the block is fixed and a spacer of the same height follows
 * it (the same pattern the authenticated AppHeader uses). The optional
 * spine renders inside the fixed block so it stays in view as the reader
 * scrolls through the year.
 */
export function MarketingHeader({
  current,
  cta,
  spine,
}: {
  current?: "pricing" | "guides" | "calculators";
  cta?: { href: string; label: string };
  spine?: ReactNode;
}) {
  const safeTop = "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))";
  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-30 border-b border-edge bg-[var(--color-cream)]"
        style={{
          paddingTop: safeTop,
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Wordmark size="md" tone="forest" />
          <MarketingNav current={current} tone="paper" />
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/login" className="btn-quiet h-9 px-3.5 text-[13px]">
              Sign in
            </Link>
            {cta ? (
              <Link href={cta.href} className="btn-primary hidden sm:inline-flex h-9 px-3.5 text-[13px]">
                {cta.label}
              </Link>
            ) : null}
          </div>
        </div>
        {spine ? (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[5.5rem] pt-2">{spine}</div>
        ) : null}
      </header>
      <div
        aria-hidden="true"
        style={{ height: `calc(${safeTop} + ${spine ? "9.5rem" : "4rem"})` }}
      />
    </>
  );
}
