// components/marketing/HomeHero.tsx
import Link from "next/link";
import { AudienceToggle, type Audience } from "@/components/AudienceToggle";
import { HeroInstrument } from "@/components/HeroInstrument";
import { HERO, PANEL, HOME_AS_OF, HOME_TAX_YEAR } from "@/components/marketing/home-copy";
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";

/**
 * The first screen: the promise on paper at left, the instrument at
 * right. The eyebrow is the one dated fact, in brass mono. The h1 is
 * followed immediately by the lede <p>; e2e/marketing-typography.spec.ts
 * selects it as `h1 + p`.
 */
export function HomeHero({ audience }: { audience: Audience }) {
  const h = HERO[audience];
  const r = taxYearRunway(HOME_TAX_YEAR, HOME_AS_OF);
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-14 sm:pb-20">
      <AudienceToggle audience={audience} />
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-14">
        <div>
          <p className="figure text-[13px] uppercase tracking-[0.04em] text-[var(--kicker)]">
            {r.asOfLabel}, {HOME_TAX_YEAR} · {r.dayOfYear} days into the tax year
          </p>
          <h1 className="display mt-5 text-[2.5rem] sm:text-6xl lg:text-[4.125rem] text-foreground max-w-[12ch]">
            {h.head}
          </h1>
          <p className="lede mt-5 max-w-[46ch]">{h.lede}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={h.ctaHref} className="btn-primary">
              {h.ctaLabel}
            </Link>
            <Link href={h.secondaryHref} className="btn-quiet">
              {h.secondaryLabel}
            </Link>
            <span className="text-sm text-muted">{h.fine}</span>
          </div>
        </div>
        <HeroInstrument taxYear={HOME_TAX_YEAR} asOf={HOME_AS_OF} sample={PANEL[audience]} />
      </div>
    </section>
  );
}
