import type { ReactNode } from "react";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { YearSpine } from "@/components/marketing/YearSpine";
import { HOME_AS_OF, HOME_TAX_YEAR } from "@/components/marketing/home-copy";
import type { NavKey } from "@/components/MarketingNav";

/**
 * The shell every secondary marketing page shares (spec 4.2): the paper
 * header with a static sample spine in its slot, the page, the footer.
 * Static means no YearSpineMotion: the fill sits at the sample date so
 * the visual baselines do not drift.
 */
export function PageShell({ current, cta, children }: { current?: NavKey; cta?: { href: string; label: string }; children: ReactNode }) {
  return (
    <>
      <MarketingHeader
        current={current}
        cta={cta ?? { href: "/example", label: "See the sample account" }}
        spine={<YearSpine taxYear={HOME_TAX_YEAR} asOf={HOME_AS_OF} variant="paper" id="page-spine" />}
      />
      {children}
      <MarketingFooter />
    </>
  );
}
