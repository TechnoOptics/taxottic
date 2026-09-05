import { PLAN_PRICING, type SubscriptionPriceKey } from "@/lib/plans/limits";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/app-stores";

// -------------------------------------------------------------------
// JSON-LD structured data for the home page.
//
// Four blobs:
//   1. Organization, who's behind Taxottic (Techno Optics LLC).
//                          Shows up in knowledge panels.
//   2. WebSite, site identity + the sitelinks searchbox
//                          target (?q=...). Lets Google render a
//                          search box under the homepage SERP card.
//   3. SoftwareApplication, that we're a finance SaaS, with the full
//                          subscription tier list as Offers. Eligible
//                          for the rich "app" treatment Google gives
//                          finance products.
//   4. SiteNavigationElement, the primary nav so Google can build
//                          sitelinks correctly.
//
// Schemas tested in https://search.google.com/test/rich-results before
// shipping. Don't add aggregateRating or review schema until we have
// real review sources to cite, fabricating either is a guidelines
// violation that risks a manual action.
// -------------------------------------------------------------------

const SITE_ORIGIN = "https://taxottic.com";

function buildSoftwareApplicationOffers() {
  // Surface every paid tier as an Offer so Google sees the price range
  // accurately. The Free tier is omitted from Offers (price 0 with a
  // payment vehicle is a guidelines violation, Free isn't a
  // commercial offer in schema.org terms). It's covered separately
  // by `freeTrial` semantics on the SoftwareApplication.
  const keys: SubscriptionPriceKey[] = [
    "filer_monthly",
    "filer_yearly",
    "solo_monthly",
    "solo_yearly",
    "studio_monthly",
    "studio_yearly",
    "scale_monthly",
    "scale_yearly",
    "practice_monthly",
    "practice_yearly",
  ];
  return keys.map((k) => {
    const p = PLAN_PRICING[k];
    const price = (p.amountCents / 100).toFixed(2);
    return {
      "@type": "Offer",
      name: p.label,
      price,
      priceCurrency: "USD",
      url: `${SITE_ORIGIN}/pricing`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price,
        priceCurrency: "USD",
        // schema.org expects ISO 8601 durations. P1M / P1Y are the
        // standard monthly / yearly billing cadences.
        billingDuration: p.interval === "month" ? "P1M" : "P1Y",
      },
    };
  });
}

/**
 * AggregateOffer summarising the individual Offers above.
 *
 * The individual Offers are valid on their own, but the price-range
 * snippet Google can render ("From $4.99") comes specifically from
 * AggregateOffer's `lowPrice`. Both forms coexist deliberately: the
 * aggregate is a summary, not a replacement, and removing the itemised
 * Offers to "simplify" would lose the per-tier detail.
 *
 * Derived from the offer array rather than written out, because a
 * hand-typed lowPrice is a number that silently stops being true the
 * first time a tier is repriced. The one thing this schema must never do
 * is advertise a price the checkout will not honour.
 *
 * CAVEAT worth knowing before reading the output: the offer set mixes
 * monthly and yearly SKUs, so the honest range spans a $4.99 monthly
 * floor to a $2,990 annual ceiling. That is a real range over real
 * offers, not an error, but it means `highPrice` is an annual figure
 * sitting next to a monthly one. `lowPrice` is the field that carries
 * the SEO value here, and it is unambiguous.
 */
function buildAggregateOffer(offers: ReturnType<typeof buildSoftwareApplicationOffers>) {
  const prices = offers.map((o) => Number(o.price));
  return {
    "@type": "AggregateOffer",
    lowPrice: Math.min(...prices).toFixed(2),
    highPrice: Math.max(...prices).toFixed(2),
    priceCurrency: "USD",
    offerCount: offers.length,
    url: `${SITE_ORIGIN}/pricing`,
  };
}

export const ORGANIZATION_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_ORIGIN}/#organization`,
  name: "Taxottic",
  // alternateName + slogan help search engines and knowledge graphs
  // bind the brand string to the entity and render a tagline in
  // knowledge panels.
  alternateName: "Taxottic Tax Forecasting",
  slogan: "A calmer way to handle your taxes.",
  url: SITE_ORIGIN,
  logo: `${SITE_ORIGIN}/icon.png`,
  description:
    "Tax forecasting and deduction guidance for freelancers, sole proprietors, and small businesses.",
  // knowsAbout anchors the entity's topical authority; areaServed
  // scopes it to the US (Taxottic forecasts US federal + state tax).
  knowsAbout: [
    "tax forecasting",
    "self-employment tax",
    "quarterly estimated taxes",
    "Schedule C deductions",
    "Qualified Business Income deduction",
    "freelancer and small business taxes",
  ],
  areaServed: { "@type": "Country", name: "United States" },
  // The parent studio. `parentOrganization` is the canonical
  // schema.org relationship; Google reads it for knowledge-panel
  // attribution.
  parentOrganization: {
    "@type": "Organization",
    name: "Techno Optics LLC",
    url: "https://technooptics.com",
  },
  // `sameAs` ties this entity to its other authoritative profiles.
  // The Wikidata item (Q140132105) is the key one: linking site →
  // Wikidata, when Wikidata also points back to the site (official
  // website P856), gives Google's Knowledge Graph a strong, mutually
  // confirmed identity for "Taxottic." Add Twitter / LinkedIn / GitHub
  // here as those profiles go live.
  //
  // The two store listings are the strongest additions available today:
  // both are third-party-verified pages that Apple and Google publish
  // under the Taxottic name, which is exactly the corroboration
  // `sameAs` exists to supply. They come from lib/app-stores.ts rather
  // than being retyped, so the store identity cannot drift between the
  // download banner, the metadata, and this graph.
  sameAs: [
    "https://www.wikidata.org/wiki/Q140132105",
    "https://technooptics.com",
    APP_STORE_URL,
    PLAY_STORE_URL,
  ],
  // Honest, public contact channel. Real email > generic
  // "contact form" placeholder.
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    email: "contact@taxottic.com",
    availableLanguage: ["English"],
  },
};

export const WEBSITE_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_ORIGIN}/#website`,
  url: SITE_ORIGIN,
  name: "Taxottic",
  description:
    "A calmer way to handle your taxes. Automatic GPS mileage tracking, bank-synced quarterly forecasts, 1,025 IRS-cited deductions, and Schedule C export.",
  publisher: { "@id": `${SITE_ORIGIN}/#organization` },
  inLanguage: "en-US",
  // Sitelinks searchbox: when this site has an internal search at
  // /search?q=..., this would tell Google to render a search box
  // under the SERP card. We don't ship a public site search yet,
  // so this is commented out, uncomment when /help-style site
  // search is live.
  //
  // potentialAction: {
  //   "@type": "SearchAction",
  //   target: {
  //     "@type": "EntryPoint",
  //     urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}`,
  //   },
  //   "query-input": "required name=search_term_string",
  // },
};

// Built once and shared by `offers` and `aggregateOffer` below. Calling
// the builder twice would work, but sharing the array is what makes the
// aggregate provably a summary OF those offers rather than a parallel
// claim that happens to agree today.
const SUBSCRIPTION_OFFERS = buildSoftwareApplicationOffers();

export const SOFTWARE_APP_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${SITE_ORIGIN}/#software`,
  name: "Taxottic",
  applicationCategory: "FinanceApplication",
  applicationSubCategory: "Tax forecasting and preparation",
  operatingSystem: "Web, iOS, Android",
  url: SITE_ORIGIN,
  // Native apps are available on both stores; surface the concrete download
  // targets so search + assistants know it's installable, not web-only.
  downloadUrl: [APP_STORE_URL, PLAY_STORE_URL],
  installUrl: [APP_STORE_URL, PLAY_STORE_URL],
  availableOnDevice: "iPhone, iPad, Android phone, Android tablet",
  description:
    "Tax forecasting software for freelancers, sole proprietors, and small businesses. Available on the web, the App Store, and Google Play. Bank-synced quarterly estimates, 1,025 IRS-cited deductions, Schedule C export, AMT and QBI math, multi-state.",
  // No aggregateRating until we have real reviews to cite.
  // No award until awards exist.
  publisher: { "@id": `${SITE_ORIGIN}/#organization` },
  // `offers` (plural) when there's more than one, Google handles
  // either form.
  offers: SUBSCRIPTION_OFFERS,
  // The summary form, derived from the exact array above so the two can
  // never disagree about what Taxottic costs.
  aggregateOffer: buildAggregateOffer(SUBSCRIPTION_OFFERS),
  // A 14-day free trial on every paid tier; the consumer voice line
  // is "No credit card. No commitment. Visit and leave at your own
  // pace." which matches Google's expectation for "free to try."
  featureList: [
    "Bank-synced quarterly tax forecasts",
    // The three mileage entries are the differentiator and were missing
    // from all eleven. An answer engine reading this list to decide
    // whether Taxottic tracks drives would have concluded it does not.
    "Automatic GPS mileage tracking",
    "Business vs personal drive classification",
    "IRS standard-rate mileage deduction with map and log",
    "1,025 IRS-cited deductions",
    "Schedule C auto-assembly + PDF export",
    "Multi-state forecasting",
    "QBI deduction math",
    "AMT detection and forecasting",
    "Quarterly estimated-tax reminders",
    "Receipt OCR via Bella",
    "Plaid + Stripe Connect bank linking",
    "Passkey / Face ID / Touch ID sign-in",
    "Tax-year 2026 with OBBBA amendments",
  ],
};

export const NAV_LD = {
  "@context": "https://schema.org",
  "@type": "SiteNavigationElement",
  name: ["Home", "Pricing", "Example", "Help", "Guides", "Changelog"],
  url: [
    `${SITE_ORIGIN}/`,
    `${SITE_ORIGIN}/pricing`,
    `${SITE_ORIGIN}/example`,
    `${SITE_ORIGIN}/help`,
    `${SITE_ORIGIN}/guides`,
    `${SITE_ORIGIN}/changelog`,
  ],
};

// DefinedTerm, the closest legitimate equivalent of a "dictionary
// entry" for a brand. It states, in machine-readable schema.org terms,
// that "Taxottic" is a defined term meaning a specific tax-forecasting
// product, with its pronunciation and a plain-language definition.
// Knowledge graphs (Google, Bing) and AI crawlers read this to answer
// "what is Taxottic?" precisely instead of guessing. A brand name
// cannot be added to a language dictionary (Merriam-Webster / OED grow
// only from documented public usage); this is the technical way to make
// the term unambiguous to machines.
export const DEFINED_TERM_LD = {
  "@context": "https://schema.org",
  "@type": "DefinedTerm",
  "@id": `${SITE_ORIGIN}/#taxottic-term`,
  name: "Taxottic",
  description:
    "Taxottic (noun; pronounced \"tax-OT-ic\") is tax-forecasting software for self-employed people and small businesses in the United States. It connects to a user's bank, keeps a running quarterly estimated-tax forecast in step with their income, and surfaces IRS-cited deductions so freelancers, contractors, sole proprietors, and small businesses can set money aside before it's due and claim what they're legally owed. Made by Techno Optics LLC.",
  inDefinedTermSet: {
    "@type": "DefinedTermSet",
    name: "Techno Optics product names",
    publisher: { "@id": `${SITE_ORIGIN}/#organization` },
  },
  url: SITE_ORIGIN,
};
