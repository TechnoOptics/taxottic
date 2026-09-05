import Link from "next/link";
import type { ReactNode } from "react";
import type { Audience } from "@/components/AudienceToggle";
import { CategoryBar, LedgerRow, MiniMap, Screen, StatRow } from "@/components/marketing/Screen";
import { HOME_TAX_YEAR, MOMENTS, type MomentKey } from "@/components/marketing/home-copy";
import { fractionOf } from "@/lib/marketing/tax-year-runway";

/**
 * The year as Taxottic runs it: five moments, each anchored to a date on
 * the spine, paired with a real product screen. The order is the
 * calendar's, so numbering would repeat what the dates already say.
 */
const SCREENS: Record<MomentKey, ReactNode> = {
  q1: (
    <Screen title="Schedule C · 2025" status="Ready to export">
      <CategoryBar label="Line 8 · Advertising" fraction={0.22} amount="$1,240" />
      <CategoryBar label="Line 9 · Car and truck" fraction={0.64} amount="$4,118" />
      <CategoryBar label="Line 18 · Office expense" fraction={0.4} amount="$2,610" />
      <CategoryBar label="Line 27a · Other (software)" fraction={1} amount="$6,384" />
      <div className="mt-2 border-t border-edge">
        <StatRow label="Total expenses" note="31 lines, every one cited" value="$18,972" />
      </div>
    </Screen>
  ),
  q2: (
    <Screen title="This week · Chase Business" status="Synced 14 min ago">
      <LedgerRow date="Jun 03" text="AWS, S3 and CloudFront" note="Software, IRC 162" amount="$342.50" tag="Applied" />
      <LedgerRow date="Jun 02" text="Delta, BOS to SFO" note="Travel, Pub 463" amount="$612.40" tag="Applied" />
      <LedgerRow date="Jun 02" text="Sweetgreen" note="Meal with a client? 50% if so" amount="$24.50" tag="Your call" tagTone="ask" />
      <LedgerRow date="Jun 01" text="Whole Foods" note="Personal, not deductible" amount="$72.18" tag="Skipped" />
      <div className="mt-2 border-t border-edge">
        <StatRow label="Q2 estimate, after this week" note="was $4,610 on Monday" value="$4,400" brass />
      </div>
    </Screen>
  ),
  road: (
    <Screen title="Drives · August" status="312 business mi · $218">
      <MiniMap />
      <LedgerRow date="Aug 28" text="Home to client site" note="8:12 to 8:49 · business" amount="22.7 mi" tag="$15.90" />
      <LedgerRow date="Aug 27" text="Supply run" note="13:05 to 13:24 · business" amount="9.1 mi" tag="$6.37" />
      <LedgerRow date="Aug 27" text="Evening drive" note="18:40 to 19:02 · unclassified" amount="12.3 mi" tag="Your call" tagTone="ask" />
    </Screen>
  ),
  q3: (
    <Screen title="Q3 · due Sep 15" status="10 days">
      <StatRow label="Estimated payment" note="federal $2,760 · state (MA) $660" value="$3,420" brass />
      <StatRow label="Set aside so far" value="$2,150" />
      <StatRow label="Still to set aside" note="about $127 a day for ten days" value="$1,270" />
      <span className="bar mt-3" aria-hidden="true"><i style={{ width: "63%" }} /></span>
    </Screen>
  ),
  dec: (
    <Screen title="Playbook · 2026" status="Est. this year">
      <LedgerRow text="Open and fund a SEP-IRA" note="up to 20% of net" amount="$3,900" />
      <LedgerRow text="Max the HSA" note="triple tax-free" amount="$1,020" />
      <LedgerRow text="Home office, simplified method" note="300 sq ft" amount="$330" />
      <LedgerRow text="Push December invoices to January" note="defer income" amount="$610" />
      <div className="mt-2 border-t border-edge">
        <StatRow label="If you took all four" value="$5,860" />
      </div>
    </Screen>
  ),
};

export function YearSequence({ audience }: { audience: Audience }) {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 sm:pb-24" aria-labelledby="year-heading">
      <div className="flex items-baseline justify-between gap-6 border-b border-edge-bright pb-4">
        <h2 id="year-heading" className="display text-[1.75rem] sm:text-[1.875rem] text-foreground">
          A tax year, the way Taxottic runs it.
        </h2>
        <span className="mono-label hidden sm:inline">Four payments · one return · every mile</span>
      </div>
      {MOMENTS[audience].map((m) => (
        <article
          key={m.key}
          data-moment={m.key}
          data-moment-at={fractionOf(HOME_TAX_YEAR, m.anchor).toFixed(4)}
          className="grid gap-6 py-10 sm:py-11 border-b border-edge last:border-b-0 lg:grid-cols-[8.75rem_minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10"
        >
          <div>
            <div className="figure text-2xl text-foreground leading-tight">{m.date}</div>
            <div className="mono-label mt-1.5 tracking-[0.06em]">{m.tag}</div>
          </div>
          <div>
            <h3 className="display text-2xl sm:text-3xl text-foreground max-w-[16ch]">{m.title}</h3>
            <p className="mt-3 text-base text-muted max-w-[44ch]">{m.body}</p>
            <Link href={m.href} className="mt-4 inline-block border-b border-foreground text-sm font-semibold text-foreground">
              {m.link}
            </Link>
          </div>
          <div>{SCREENS[m.key]}</div>
        </article>
      ))}
    </section>
  );
}
