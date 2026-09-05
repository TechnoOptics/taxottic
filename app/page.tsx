import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JsonLd } from "@/components/seo/JsonLd";
import { AppDownloadBanner } from "@/components/AppDownloadBanner";
import { type Audience } from "@/components/AudienceToggle";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { YearSpine } from "@/components/marketing/YearSpine";
import { YearSpineMotion } from "@/components/marketing/YearSpineMotion";
import { HomeHero } from "@/components/marketing/HomeHero";
import { YearSequence } from "@/components/marketing/YearSequence";
import { PriceStrip } from "@/components/marketing/PriceStrip";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { HERO, HOME_AS_OF, HOME_TAX_YEAR } from "@/components/marketing/home-copy";
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";
import {
  DEFINED_TERM_LD,
  NAV_LD,
  ORGANIZATION_LD,
  SOFTWARE_APP_LD,
  WEBSITE_LD,
} from "@/lib/marketing/home-jsonld";

/**
 * The marketing home. Routing, structured data and composition only; the
 * copy is components/marketing/home-copy.ts and every section is its own
 * component. Design: docs/superpowers/specs/2026-09-05-year-interface-design.md.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const sp = await searchParams;
  // "enterprise" is kept as an alias for "firm" so old shared links land.
  const audience: Audience =
    sp.audience === "firm" || sp.audience === "enterprise"
      ? "firm"
      : sp.audience === "business"
        ? "business"
        : "personal";
  const cta = { href: HERO[audience].ctaHref, label: HERO[audience].ctaLabel };
  const today = taxYearRunway(HOME_TAX_YEAR, HOME_AS_OF).fill;

  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <JsonLd data={ORGANIZATION_LD} />
      <JsonLd data={WEBSITE_LD} />
      <JsonLd data={SOFTWARE_APP_LD} />
      <JsonLd data={NAV_LD} />
      <JsonLd data={DEFINED_TERM_LD} />

      <AppDownloadBanner />

      <MarketingHeader
        cta={cta}
        spine={
          <YearSpine taxYear={HOME_TAX_YEAR} asOf={HOME_AS_OF} variant="paper" id="year-spine" />
        }
      />
      <YearSpineMotion spineId="year-spine" todayFill={today} />

      <HomeHero audience={audience} />
      <YearSequence audience={audience} />
      <PriceStrip />
      <MarketingFooter />
    </main>
  );
}
