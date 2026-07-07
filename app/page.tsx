import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import { AppDownloadBanner } from "@/components/AppDownloadBanner";
import { AppStoreBadges } from "@/components/AppStoreBadges";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/app-stores";
import {
  PLAN_PRICING,
  type SubscriptionPriceKey,
} from "@/lib/plans/limits";

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

const ORGANIZATION_LD = {
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
  sameAs: [
    "https://www.wikidata.org/wiki/Q140132105",
    "https://technooptics.com",
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

const WEBSITE_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_ORIGIN}/#website`,
  url: SITE_ORIGIN,
  name: "Taxottic",
  description:
    "A calmer way to handle your taxes. Bank-synced quarterly forecasts, 1,025 IRS-cited deductions, Schedule C export, multi-state.",
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

const SOFTWARE_APP_LD = {
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
  offers: buildSoftwareApplicationOffers(),
  // A 14-day free trial on every paid tier; the consumer voice line
  // is "No credit card. No commitment. Visit and leave at your own
  // pace." which matches Google's expectation for "free to try."
  featureList: [
    "Bank-synced quarterly tax forecasts",
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

const NAV_LD = {
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
const DEFINED_TERM_LD = {
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

type Audience = "personal" | "business" | "firm";

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
  // "enterprise" kept as an alias for "firm" so any old shared link still
  // lands on the firm view.
  const audience: Audience =
    sp.audience === "firm" || sp.audience === "enterprise"
      ? "firm"
      : sp.audience === "business"
        ? "business"
        : "personal";

  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      {/* JSON-LD: Organization, WebSite, SoftwareApplication, primary
          nav. Rendered server-side so crawlers see them on first
          fetch. See top of file for the schema rationale + the
          aggregateRating call-out (we do NOT include fake reviews). */}
      <JsonLd data={ORGANIZATION_LD} />
      <JsonLd data={WEBSITE_LD} />
      <JsonLd data={SOFTWARE_APP_LD} />
      <JsonLd data={NAV_LD} />
      <JsonLd data={DEFINED_TERM_LD} />

      {/* Web-only, dismissible "get the mobile app" banner (App Store +
          Google Play). Hidden inside the native shell. */}
      <AppDownloadBanner />

      {/* Forest header band - visually merges into the Hero gradient below
          so the page opens with one continuous premium-green field. Same
          gradient + gold underline as the authenticated AppHeader, so the
          marketing site feels like the same product the user signs into. */}
      <header
        className="fixed top-0 left-0 right-0 z-30"
        style={{
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
          borderBottom: "1px solid rgba(213, 187, 126, 0.14)",
          // Native iOS draws the WebView UNDER the status bar
          // (capacitor.config.ts StatusBar.overlaysWebView), so without
          // a top inset the wordmark/"Sign in" land beneath the notch /
          // Dynamic Island. Pad by the real safe-area inset, same
          // device-aware expression the authenticated AppHeader uses
          // (--app-safe-top is the natively-measured floor published by
          // CapacitorNativeInit; env() wins via max() wherever WKWebView
          // reports it). 0 on web, so no visual change in the browser.
          paddingTop:
            "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[4.25rem] flex items-center justify-between">
          <Wordmark size="md" tone="cream" />
          <SignInIconLink />
        </div>
        {/* Thin gold sweep - same signature line as the AppHeader. */}
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 bottom-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(213,187,126,0.55) 35%, rgba(242,216,150,0.95) 50%, rgba(213,187,126,0.55) 65%, transparent 100%)",
          }}
        />
      </header>
      {/* Spacer for the now-fixed header. `sticky` can't be used: the
          Capacitor WebView needs overflow-x:clip on html/body, which
          breaks position:sticky, so the header is fixed + a matching
          spacer (same pattern as the authenticated AppHeader). Height =
          safe-area top inset + the 4.25rem header row. */}
      <div
        aria-hidden="true"
        style={{
          height:
            "calc(max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) + 4.25rem)",
        }}
      />

      <Hero audience={audience} />
      <Capabilities audience={audience} />
      <ProductTour audience={audience} />
      <ProofBand />
      <FomoBand audience={audience} />
      <FinalCta audience={audience} />
      <Footer />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

const HERO: Record<
  Audience,
  {
    head: React.ReactNode;
    sub: React.ReactNode;
    ctaHref: string;
    ctaLabel: string;
    pricingHref: string;
    footnote: string;
  }
> = {
  personal: {
    head: (
      <>
        A calmer way to handle{" "}
        <span className="gold-shine">your personal taxes.</span>
      </>
    ),
    sub: (
      <>
        Taxottic tracks the personal deductions you&apos;ve already earned,
        keeps a live federal + state forecast in step with your accounts, and
        nudges you to set money aside before you need it. For W-2 earners,
        freelancers, and side-hustlers.
      </>
    ),
    ctaHref: "/example",
    ctaLabel: "Take a look around",
    pricingHref: "/pricing",
    footnote:
      "No credit card. No commitment. Visit and leave at your own pace.",
  },
  business: {
    head: (
      <>
        A calmer way to run{" "}
        <span className="gold-shine">your business&apos;s taxes.</span>
      </>
    ),
    sub: (
      <>
        Bank-synced expenses auto-matched to IRS codes, business miles tracked
        automatically, a forecast that keeps pace with your books, and a
        ready-to-file Schedule C waiting at year-end. For sole props, LLCs,
        S-corps, and their teams.
      </>
    ),
    ctaHref: "/example",
    ctaLabel: "Take a look around",
    pricingHref: "/pricing",
    footnote:
      "No credit card. No commitment. Visit and leave at your own pace.",
  },
  firm: {
    head: (
      <>
        A calmer view of{" "}
        <span className="gold-shine">every client&apos;s books.</span>
      </>
    ),
    sub: (
      <>
        A shared workspace where your clients keep their books in order on
        their own time, and your team picks up where they left off. Bulk
        exports, engagement workflow, firm-wide analytics. Branded as your
        firm, never as ours.
      </>
    ),
    ctaHref: "/book?for=firm",
    ctaLabel: "Have a quick chat",
    pricingHref: "/pricing#practice",
    footnote:
      "White-glove migration. Branded portal. Per-seat or per-client.",
  },
};

function Hero({ audience }: { audience: Audience }) {
  const h = HERO[audience];
  return (
    <section className="relative overflow-hidden">
      {/* Forest gradient backdrop with subtle gold radial */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(800px 320px at 20% 0%, rgba(213,187,126,0.18), transparent 70%), radial-gradient(700px 320px at 100% 100%, rgba(213,187,126,0.10), transparent 70%)",
        }}
      />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-20 sm:pb-28 text-cream">
        <AudienceToggle audience={audience} />

        <h1 className="display mt-8 text-4xl sm:text-6xl lg:text-7xl text-cream max-w-4xl leading-[1.05]">
          {h.head}
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-cream/80 max-w-2xl leading-relaxed">
          {h.sub}
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          {/* /example is a real read-only sample dashboard so the "take a
              look" CTAs match their words; firm keeps booking as the CTA. */}
          <Link href={h.ctaHref} className="btn-primary">
            {h.ctaLabel}
          </Link>
          <Link
            href={h.pricingHref}
            className="inline-flex items-center justify-center h-11 px-5 rounded-[0.625rem] border border-gold-300/30 text-cream hover:bg-white/5 transition-colors text-sm"
          >
            See pricing
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-11 px-5 rounded-[0.625rem] text-cream/80 hover:text-cream transition-colors text-sm"
          >
            Sign in
          </Link>
        </div>

        <p className="mt-6 text-xs uppercase tracking-[0.2em] text-gold-300">
          {h.footnote}
        </p>
      </div>
    </section>
  );
}

function AudienceToggle({ audience }: { audience: Audience }) {
  const segments: { id: Audience; label: string }[] = [
    { id: "personal", label: "For me" },
    { id: "business", label: "For my business" },
    { id: "firm", label: "For my firm" },
  ];
  return (
    <div
      className="inline-flex p-1 rounded-full bg-white/8 border border-gold-300/20 backdrop-blur"
      role="tablist"
      aria-label="Choose audience"
    >
      {segments.map((s) => {
        const active = audience === s.id;
        return (
          <Link
            key={s.id}
            href={`/?audience=${s.id}`}
            scroll={false}
            role="tab"
            aria-selected={active}
            className={
              "px-5 py-2 rounded-full text-sm font-medium transition-all " +
              (active
                ? "bg-cream text-forest-900 shadow"
                : "text-cream/80 hover:text-cream hover:bg-white/5")
            }
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

type Capability = {
  kicker: string;
  title: string;
  body: string;
  pull: string;
};

const PERSONAL: Capability[] = [
  {
    kicker: "Live Forecast",
    title: "A running picture of what you owe.",
    body: "Every income line, every expense, every quarterly safe harbor folds into a federal + state forecast that updates in step with your bank. Helpful, never alarming.",
    pull: "A friendly number you can trust.",
  },
  {
    kicker: "1,025 IRS-Cited Deductions",
    title: "Every deduction you've earned, neatly organised.",
    body: "Each transaction is matched against 1,025 deduction items from IRS Pub 334, 463, 535, 587, and 946. IRC section cited, source URL one tap away. We do the lookup; you decide.",
    pull: "Quietly thorough. Always cited.",
  },
  {
    kicker: "Bella · A Gentle Tax Guide",
    title: "Plain-English answers when tax questions come up.",
    body: "Ask 'is this trip deductible?' and you'll get a careful answer plus the IRS publication, plus a memo-line phrasing your future self will thank you for.",
    pull: "Patient. Cited. Always there.",
  },
  {
    kicker: "Quarterly Reminders",
    title: "Gentle nudges, in good time.",
    body: "Quarterly set-asides calculated from your live forecast, with reminders that fire two weeks early. A small habit that makes April feel ordinary.",
    pull: "A small habit that pays off.",
  },
];

const BUSINESS: Capability[] = [
  {
    kicker: "Automatic Expensing",
    title: "Your bank feed becomes your books.",
    body: "Every business transaction syncs hourly and lands pre-matched to an IRS deduction code, cited to the publication. Mixed personal/business? Reclassify in a tap. No receipts to shoebox, no month-end catch-up.",
    pull: "The books keep themselves.",
  },
  {
    kicker: "Automatic Mileage",
    title: "Every business mile, captured on its own.",
    body: "The app logs drives in the background by GPS, separates business from personal, and turns them into an IRS-rate deduction with a defensible map + log. Track a whole team and see each driver in their own colour.",
    pull: "Miles you'd have left on the table.",
  },
  {
    kicker: "1,025 Deductions + Live Forecast",
    title: "What you owe, and what you've earned back.",
    body: "Federal + state brackets applied to live income and the deductions you've claimed against 1,025 IRS-cited items. QBI, home office, vehicle, meals, all handled, all moving in step with your bank.",
    pull: "A number you can trust, always current.",
  },
  {
    kicker: "Year-End, Done for You",
    title: "A ready-to-file Schedule C, plus a plan.",
    body: "Every applied transaction lands on its proper Schedule C line, meals at 50%, vehicle split correctly, exported to PDF + CSV for your CPA. A savings playbook shows the moves still worth making before December.",
    pull: "December feels like any other month.",
  },
];

const FIRM: Capability[] = [
  {
    kicker: "Multi-Client Console",
    title: "Every client, in one calm place.",
    body: "Multi-company, multi-engagement. See who's filed, who's still gathering, and who could use a hand - all at hq.taxottic.com without juggling tabs.",
    pull: "Less context-switching. More advising.",
  },
  {
    kicker: "Engagement Workflow",
    title: "Engagements that move themselves forward.",
    body: "Send engagement requests, and gentle follow-ups go out on their own when clients haven't responded. A transparency view tells your team where each relationship stands without anyone writing an email.",
    pull: "We handle the chase, your team does the work.",
  },
  {
    kicker: "Branded Firm Portal",
    title: "Your firm's voice, end to end.",
    body: "Your logo. Your colours. Your firm's voice on every reminder. Branded subscriptions billed under your name. Clients only ever see you.",
    pull: "It feels like your firm, because it is.",
  },
  {
    kicker: "Bulk Operations",
    title: "Move quickly when you want to.",
    body: "Bulk Schedule C export. Firm-wide deduction analytics. Multi-client reminders. Outreach that runs on its own. There when the same thing needs doing fifty times.",
    pull: "Hours back to your team, every month.",
  },
];

const CAP_HEADING: Record<Audience, string> = {
  personal:
    "Built so the tax part of your year stops feeling like the scary part.",
  business:
    "Built so running the business is the part you think about, not the tax.",
  firm: "Built so your firm operates the way clients already think it does.",
};

function Capabilities({ audience }: { audience: Audience }) {
  const items =
    audience === "personal" ? PERSONAL : audience === "business" ? BUSINESS : FIRM;
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        What you get
      </div>
      <h2 className="display mt-3 text-3xl sm:text-5xl text-forest-900 max-w-3xl">
        {CAP_HEADING[audience]}
      </h2>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {items.map((c) => (
          <article
            key={c.kicker}
            className="card card-hover p-7 flex flex-col gap-3"
          >
            <div className="text-[10px] uppercase tracking-[0.22em] text-gold-700">
              {c.kicker}
            </div>
            <h3 className="display text-2xl text-forest-900 leading-snug">
              {c.title}
            </h3>
            <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
              {c.body}
            </p>
            <div className="mt-1 text-sm text-forest-700 italic">{c.pull}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Product tour - Company X running through the app
// Three alternating rows. Each "mockup" is hand-built HTML in the same
// design language as the real app (cards, gold kickers, forest text,
// Fraunces serif on display) so it reads as a screenshot of the product
// rather than a generic illustration.
// ---------------------------------------------------------------------------

type TourRow = {
  mockup: React.ReactNode;
  kicker: string;
  title: string;
  body: string;
  tags: string[];
};

const TOUR: Record<
  Audience,
  { eyebrow: string; heading: React.ReactNode; intro: string; rows: TourRow[] }
> = {
  personal: {
    eyebrow: "See it on your return",
    heading: (
      <>
        Your taxes, <span className="gold-shine">quietly handled.</span>
      </>
    ),
    intro:
      "Connect the accounts you already have. Taxottic finds the personal deductions hiding in them, keeps a live forecast, and lays out the moves still worth making, without a spreadsheet in sight.",
    rows: [
      {
        mockup: <BankFeedMockup />,
        kicker: "Every day - Automatic expensing",
        title: "Your accounts do the sorting.",
        body: "New transactions sync on their own and land pre-matched to a deductible category, IRC section cited, source one tap away. Charitable gifts, medical, education, student-loan interest, tagged the moment they clear. One tap to keep, dismiss, or split.",
        tags: ["Hourly sync", "IRS-cited", "Auto-applied"],
      },
      {
        mockup: <DeductionCatalogMockup />,
        kicker: "Always on - 1,025 IRS codes",
        title: "Every deduction, cited to the source.",
        body: "The full 1,025-item catalog from IRS Pub 502, 526, 970, and more, filtered to what actually applies to you. Each one links to the IRC section and the publication that explains it, so nothing you claim is a guess.",
        tags: ["1,025 deductions", "IRC + Pub cited", "Filtered to you"],
      },
      {
        mockup: <ForecastMockup />,
        kicker: "Live - Forecast",
        title: "A number that keeps pace.",
        body: "Federal and state brackets applied to your live income and the deductions you've claimed. The figure in the corner of every screen moves with the math, with a two-weeks-early nudge before each quarterly date.",
        tags: ["Federal + state", "Quarterly reminders", "Updated automatically"],
      },
      {
        mockup: <PlaybookMockup />,
        kicker: "Any time - Savings playbook",
        title: "The moves still worth making.",
        body: "A short, personalized list of legitimate ways to lower the bill, IRA and HSA room, energy credits, timing, each with the dollars it would save at your bracket. Adopt one and watch the forecast respond.",
        tags: ["Personalized", "Dollar impact", "IRS-backed"],
      },
    ],
  },
  business: {
    eyebrow: "See it on Company X",
    heading: (
      <>
        A real business, <span className="gold-shine">the calm way.</span>
      </>
    ),
    intro:
      "Company X connected one bank account on a Tuesday. By Friday their Q4 forecast, categorized expenses, tracked mileage, and a ready-to-file Schedule C were quietly waiting, no spreadsheet opened, no inbox checked twice.",
    rows: [
      {
        mockup: <BankFeedMockup />,
        kicker: "Hour 1 - Automatic expensing",
        title: "The bank feed becomes the books.",
        body: "Every active account stays in step every hour. New transactions land tagged against the 1,025-item IRS deduction catalog, IRC section cited. Meals at 50%, software, travel, home office, all applied automatically. One tap to dismiss or split.",
        tags: ["Hourly bank sync", "1,025 IRS-cited deductions", "Auto-applied"],
      },
      {
        mockup: <MileageMockup />,
        kicker: "In the background - Mileage",
        title: "Every business mile logs itself.",
        body: "The app detects drives by GPS, tells business from personal, and turns each into an IRS-standard-rate deduction with a map and a defensible log. Managers see the whole team, every driver in their own colour.",
        tags: ["GPS auto-track", "$0.70 / mi", "Team map"],
      },
      {
        mockup: <ForecastMockup />,
        kicker: "Live - Forecast",
        title: "The forecast keeps pace, quietly.",
        body: "Federal and state brackets applied to live YTD income and the deductions claimed, QBI, SE tax, and safe-harbor all handled. The number in the corner moves with the math, no nightly recompute, no refresh.",
        tags: ["Federal + state", "QBI + SE tax", "Updated automatically"],
      },
      {
        mockup: <ScheduleCMockup />,
        kicker: "December - Year-end, done for you",
        title: "One click assembles the whole Schedule C.",
        body: "Every applied transaction lands on its proper Schedule C line. Meals 50% rule applied, vehicle split between standard and actual, everything cited to the IRS publication and exported to PDF + CSV, ready for your CPA.",
        tags: ["Schedule C", "IRS-cited", "PDF + CSV"],
      },
    ],
  },
  firm: {
    eyebrow: "See it across your book",
    heading: (
      <>
        Every client, <span className="gold-shine">one calm console.</span>
      </>
    ),
    intro:
      "Your clients keep their own books in order on their own time, bank-synced and pre-categorized. Your team opens one console to see where every engagement stands and export the whole book at once, branded as your firm.",
    rows: [
      {
        mockup: <ClientRosterMockup />,
        kicker: "The console - Every client",
        title: "Who's filed, who's gathering, at a glance.",
        body: "Multi-company, multi-engagement, one roster. See readiness, deductions claimed, and the next action for every client without juggling tabs, and let automatic follow-ups chase the ones who've gone quiet.",
        tags: ["Multi-client", "Engagement workflow", "Auto follow-ups"],
      },
      {
        mockup: <ScheduleCMockup />,
        kicker: "Reports - Data sheets",
        title: "Export the whole book in one pass.",
        body: "Bulk Schedule C exports, monthly income/expense data sheets, and firm-wide deduction analytics, every line cited to its IRS publication. PDF for the client, CSV for your workpapers.",
        tags: ["Bulk export", "PDF + CSV", "IRS-cited"],
      },
      {
        mockup: <ForecastMockup />,
        kicker: "Per client - Live forecast",
        title: "Advise from a number that's already right.",
        body: "Each client's federal + state forecast is current the moment you open it, no data entry, no reconciliation first. Your most thoughtful hours go to advising, not to catching the books up.",
        tags: ["Always current", "Federal + state", "Branded as you"],
      },
    ],
  },
};

function ProductTour({ audience }: { audience: Audience }) {
  const t = TOUR[audience];
  return (
    <section className="bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          {t.eyebrow}
        </div>
        <h2 className="display mt-3 text-3xl sm:text-5xl text-forest-900 max-w-3xl">
          {t.heading}
        </h2>
        <p className="mt-4 text-base sm:text-lg text-ink-soft max-w-2xl leading-relaxed">
          {t.intro}
        </p>

        <div className="mt-14 grid gap-16">
          {t.rows.map((r, i) => (
            <Row key={r.kicker} reverse={i % 2 === 1}>
              {r.mockup}
              <Caption
                kicker={r.kicker}
                title={r.title}
                body={r.body}
                tags={r.tags}
              />
            </Row>
          ))}
        </div>
      </div>
    </section>
  );
}

function Row({
  reverse = false,
  children,
}: {
  reverse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "grid gap-8 lg:gap-12 lg:grid-cols-2 items-center " +
        (reverse ? "lg:[&>*:first-child]:order-2" : "")
      }
    >
      {children}
    </div>
  );
}

function Caption({
  kicker,
  title,
  body,
  tags,
}: {
  kicker: string;
  title: string;
  body: string;
  tags: string[];
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.22em] text-gold-700">
        {kicker}
      </div>
      <h3 className="display mt-3 text-2xl sm:text-3xl text-forest-900 leading-snug">
        {title}
      </h3>
      <p className="mt-4 text-base text-ink-soft leading-relaxed">{body}</p>
      <ul className="mt-5 flex flex-wrap gap-2">
        {tags.map((t) => (
          <li
            key={t}
            className="text-[11px] uppercase tracking-[0.18em] text-forest-700 px-2.5 py-1 rounded-full bg-forest-50 border border-forest-100"
          >
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Wrapper that gives every mockup the same "lifted screenshot" frame so
// the product tour reads as a series of real captures rather than ad-hoc
// boxes.
function MockupFrame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div
        className="absolute -inset-4 -z-10 rounded-[28px] opacity-50 blur-2xl"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 40%, rgba(213,187,126,0.25), transparent 70%)",
        }}
      />
      <div className="rounded-2xl border border-forest-100 bg-[var(--color-cream)] shadow-[0_24px_60px_-30px_rgba(29, 40, 67,0.35)] overflow-hidden">
        {/* Faux app chrome: forest header strip with the company badge */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{
            background:
              "linear-gradient(180deg, #2a3a5e 0%, #1d2843 100%)",
          }}
        >
          <div className="flex items-center gap-2">
            <CompanyMonogram />
            <span className="text-[11px] tracking-[0.2em] uppercase text-cream/80">
              Company X · {label}
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-[0.2em] text-gold-300">
            Live
          </span>
        </div>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

function CompanyMonogram() {
  // 24x24 "CX" tile in the brand gradient, used as the Company X
  // identity throughout the mockups.
  return (
    <div
      className="size-6 rounded-md flex items-center justify-center text-[10px] font-semibold"
      style={{
        background:
          "linear-gradient(135deg, #2a3a5e 0%, #1d2843 100%)",
        color: "#d5bb7e",
        boxShadow: "inset 0 0 0 1px rgba(213,187,126,0.25)",
      }}
    >
      CX
    </div>
  );
}

function BankFeedMockup() {
  const txs = [
    {
      merchant: "Adobe Creative Cloud",
      date: "Nov 12",
      amount: "$89.99",
      category: "Software / subscriptions",
      auto: true,
    },
    {
      merchant: "AWS · S3 + CloudFront",
      date: "Nov 11",
      amount: "$342.50",
      category: "Software / subscriptions",
      auto: true,
    },
    {
      merchant: "Delta Airlines · BOS → SFO",
      date: "Nov 09",
      amount: "$612.40",
      category: "Travel",
      auto: true,
    },
    {
      merchant: "Marriott Boston Seaport",
      date: "Nov 09",
      amount: "$384.00",
      category: "Travel",
      auto: true,
    },
    {
      merchant: "Sweetgreen · with client",
      date: "Nov 08",
      amount: "$24.50",
      category: "Meals (50%)",
      auto: true,
    },
  ];
  return (
    <MockupFrame label="Bank feed">
      <div className="flex items-center justify-between text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Synced 14 minutes ago · Chase Business
        </span>
        <span>5 new this week</span>
      </div>
      <ul className="mt-4 grid gap-2">
        {txs.map((t, i) => (
          // flex-wrap on the row so the APPLIED badge can drop to a new
          // line on narrow viewports instead of pushing the row past the
          // mockup edge. Sub-line inside also wraps so "Bella suggested:
          // Software / subscriptions" never forces overflow.
          <li
            key={i}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-white border border-forest-100 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1 basis-full sm:basis-auto">
              <div className="text-sm text-forest-900 truncate">
                {t.merchant}
              </div>
              <div className="text-[11px] text-ink-muted mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span>{t.date}</span>
                <span className="text-gold-700">·</span>
                <span className="text-gold-600">↳</span>
                <span className="text-forest-700">Bella suggested:</span>
                <span className="text-forest-900 font-medium">{t.category}</span>
              </div>
            </div>
            <div className="text-sm tabular-nums text-forest-900 shrink-0">
              {t.amount}
            </div>
            <span className="text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5 shrink-0">
              applied
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 text-[11px] text-ink-muted">
        Bella sat behind every suggestion. Each line links back to the IRS
        publication that explains why it qualifies.
      </div>
    </MockupFrame>
  );
}

function ForecastMockup() {
  return (
    <MockupFrame label="Forecast · Tax year 2026">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-lg bg-white border border-forest-100 p-4">
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
            Federal owed
          </div>
          <div className="display mt-2 text-3xl text-forest-900 tabular-nums">
            $14,820
          </div>
          <div className="mt-1 text-[11px] text-ink-muted">
            ↓ $620 from last sync · Q4 estimated
          </div>
        </div>
        <div className="rounded-lg bg-white border border-forest-100 p-4">
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
            State owed (MA)
          </div>
          <div className="display mt-2 text-3xl text-forest-900 tabular-nums">
            $3,210
          </div>
          <div className="mt-1 text-[11px] text-ink-muted">
            ↓ $135 · synced 2 minutes ago
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-lg bg-white border border-forest-100 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
            YTD deductions claimed
          </div>
          <div className="text-[11px] text-ink-muted">
            7 of 8 starter categories
          </div>
        </div>
        <div className="display mt-2 text-2xl text-forest-900 tabular-nums">
          $42,807
        </div>
        <ul className="mt-4 grid gap-2">
          {[
            { label: "Software / subscriptions", amount: "$12,840", w: 100 },
            { label: "Travel", amount: "$8,420", w: 66 },
            { label: "Home office (8829)", amount: "$3,840", w: 30 },
            { label: "Meals (50% applied)", amount: "$1,205", w: 9 },
          ].map((r) => (
            // The LI itself needs min-w-0 so the parent grid actually
            // shrinks it below intrinsic content width on narrow phones
            // (grid items default to min-width: auto = content min, which
            // prevents shrinking even when the parent is constrained).
            // Bar drops from view below sm so we have room for label + amount.
            <li
              key={r.label}
              className="min-w-0 flex items-center gap-2 sm:gap-3 text-[12px]"
            >
              <span className="min-w-0 flex-1 truncate text-forest-900">
                {r.label}
              </span>
              <span className="hidden sm:inline-block flex-none rounded-full bg-forest-50 overflow-hidden w-24 h-1.5">
                <span
                  className="block h-full bg-gold-400"
                  style={{ width: `${r.w}%` }}
                />
              </span>
              <span className="shrink-0 w-14 sm:w-16 text-right tabular-nums text-forest-700">
                {r.amount}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 text-[11px] text-ink-muted">+ 3 more categories</div>
      </div>

      <div className="mt-4 text-[11px] text-ink-muted flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Recalculated automatically - last change 2 minutes ago when AWS
        landed.
      </div>
    </MockupFrame>
  );
}

function ScheduleCMockup() {
  const lines: { line: string; label: string; amount: string }[] = [
    { line: "Line 8", label: "Advertising", amount: "$2,400" },
    { line: "Line 18", label: "Office expense + software", amount: "$11,640" },
    { line: "Line 22", label: "Supplies", amount: "$890" },
    { line: "Line 24a", label: "Travel", amount: "$8,420" },
    { line: "Line 24b", label: "Meals (50% applied)", amount: "$1,205" },
    { line: "Line 25", label: "Utilities (incl. internet)", amount: "$1,860" },
    { line: "Line 27a", label: "Bank fees + continuing ed", amount: "$420" },
    { line: "Line 30", label: "Home office (Form 8829)", amount: "$3,840" },
  ];
  return (
    <MockupFrame label="Year-end · Schedule C export">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
            Tax year 2026 · Auto-assembled
          </div>
          <div className="display text-xl text-forest-900 mt-1">
            Schedule C · Profit or Loss from Business
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-1">
          Ready
        </span>
      </div>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            <th className="text-left font-normal pb-2">Line</th>
            <th className="text-left font-normal pb-2">Category</th>
            <th className="text-right font-normal pb-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line} className="border-t border-forest-100">
              <td className="py-2 text-forest-700 text-xs tabular-nums w-20">
                {l.line}
              </td>
              <td className="py-2 text-forest-900">{l.label}</td>
              <td className="py-2 text-right text-forest-900 tabular-nums">
                {l.amount}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-forest-200">
            <td colSpan={2} className="py-3 text-forest-900 font-medium">
              Total deductions
            </td>
            <td className="py-3 text-right tabular-nums text-forest-900 font-medium">
              $30,675
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-[11px] text-ink-muted">
          Built from 287 categorized bank transactions. Every line cites
          its IRS publication.
        </div>
        <div className="flex gap-2 shrink-0">
          <span className="text-[10px] uppercase tracking-[0.18em] text-forest-700 px-2.5 py-1 rounded-full bg-forest-50 border border-forest-100">
            PDF
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-forest-700 px-2.5 py-1 rounded-full bg-forest-50 border border-forest-100">
            CSV
          </span>
        </div>
      </div>
    </MockupFrame>
  );
}

function DeductionCatalogMockup() {
  const rows = [
    { code: "IRC §162", label: "Ordinary + necessary business expense", pub: "Pub 535", on: true },
    { code: "IRC §274(n)", label: "Business meals (50%)", pub: "Pub 463", on: true },
    { code: "IRC §280A", label: "Home office", pub: "Pub 587", on: true },
    { code: "IRC §213", label: "Medical + dental", pub: "Pub 502", on: false },
    { code: "IRC §170", label: "Charitable contributions", pub: "Pub 526", on: true },
    { code: "IRC §221", label: "Student-loan interest", pub: "Pub 970", on: false },
  ];
  return (
    <MockupFrame label="Deduction catalog">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
          1,025 IRS-cited deductions
        </div>
        <div className="text-[11px] text-ink-muted">Filtered to your situation</div>
      </div>
      <ul className="mt-4 grid gap-2">
        {rows.map((r) => (
          <li
            key={r.code}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-white border border-forest-100 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1 basis-full sm:basis-auto">
              <div className="text-sm text-forest-900 truncate">{r.label}</div>
              <div className="text-[11px] text-ink-muted mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-forest-700 font-medium tabular-nums">{r.code}</span>
                <span className="text-gold-700">·</span>
                <span>{r.pub}</span>
                <span className="text-gold-600 underline decoration-dotted">source</span>
              </div>
            </div>
            <span
              className={
                "text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 shrink-0 border " +
                (r.on
                  ? "text-emerald-700 bg-emerald-50 border-emerald-100"
                  : "text-forest-700 bg-forest-50 border-forest-100")
              }
            >
              {r.on ? "applies" : "eligible"}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 text-[11px] text-ink-muted">
        + 1,019 more, each tied to its IRC section and IRS publication.
      </div>
    </MockupFrame>
  );
}

function MileageMockup() {
  const trips = [
    { route: "Office → client site", mi: "18.4", driver: "You", color: "#F2D896" },
    { route: "Supplier pickup", mi: "9.1", driver: "Grace", color: "#7DD3FC" },
    { route: "Site visit → home", mi: "22.7", driver: "Marco", color: "#86EFAC" },
  ];
  return (
    <MockupFrame label="Mileage · auto-tracked">
      {/* Stylised route map: navy dial with a few coloured driver trails. */}
      <div
        className="relative rounded-lg overflow-hidden h-32 border border-forest-100"
        style={{ background: "linear-gradient(180deg,#1d2843,#121a2a)" }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 300 120" className="absolute inset-0 w-full h-full">
          <path d="M20 96 C 70 96, 90 40, 150 44" fill="none" stroke="#F2D896" strokeWidth="3" strokeLinecap="round" />
          <path d="M40 20 C 120 30, 150 90, 250 84" fill="none" stroke="#7DD3FC" strokeWidth="3" strokeLinecap="round" />
          <path d="M150 100 C 200 96, 220 30, 285 26" fill="none" stroke="#86EFAC" strokeWidth="3" strokeLinecap="round" />
          <circle cx="20" cy="96" r="4" fill="#34D399" />
          <circle cx="285" cy="26" r="4" fill="#F2D896" />
        </svg>
      </div>
      <ul className="mt-4 grid gap-2">
        {trips.map((t) => (
          <li
            key={t.route}
            className="flex items-center justify-between gap-3 rounded-lg bg-white border border-forest-100 px-3 py-2"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="inline-block w-3 h-1.5 rounded shrink-0" style={{ background: t.color }} />
              <span className="text-sm text-forest-900 truncate">{t.route}</span>
            </span>
            <span className="flex items-center gap-3 shrink-0 text-[12px]">
              <span className="text-ink-muted">{t.driver}</span>
              <span className="tabular-nums text-forest-900">{t.mi} mi</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between text-[11px]">
        <span className="text-ink-muted flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Tracking in the background
        </span>
        <span className="text-forest-700">
          312 business mi · <span className="text-forest-900 font-medium tabular-nums">$218 deduction</span>
        </span>
      </div>
    </MockupFrame>
  );
}

function PlaybookMockup() {
  const moves = [
    { move: "Open + fund a SEP-IRA", note: "up to 20% of net", save: "$3,900" },
    { move: "Max the HSA", note: "triple tax-free", save: "$1,020" },
    { move: "Home-office (simplified)", note: "300 sq ft", save: "$330" },
    { move: "Push Dec invoices to January", note: "defer income", save: "$610" },
  ];
  return (
    <MockupFrame label="Savings playbook">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
          Moves still worth making
        </div>
        <div className="text-[11px] text-ink-muted">Est. this year</div>
      </div>
      <ul className="mt-4 grid gap-2">
        {moves.map((m) => (
          <li
            key={m.move}
            className="flex items-center justify-between gap-3 rounded-lg bg-white border border-forest-100 px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="text-sm text-forest-900 truncate">{m.move}</div>
              <div className="text-[11px] text-ink-muted mt-0.5">{m.note}</div>
            </div>
            <span className="text-sm tabular-nums text-emerald-700 shrink-0">
              {m.save}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] text-ink-muted">Adopt one and the forecast responds.</span>
        <span className="text-sm text-forest-900 font-medium tabular-nums">
          ~$5,860 total
        </span>
      </div>
    </MockupFrame>
  );
}

function ClientRosterMockup() {
  const clients = [
    { name: "Meridian Studio LLC", status: "Ready to file", tone: "good", ready: 100 },
    { name: "Harbor Coffee Co.", status: "3 to review", tone: "warn", ready: 82 },
    { name: "Delgado Consulting", status: "Gathering docs", tone: "neutral", ready: 54 },
    { name: "North & Vine", status: "Ready to file", tone: "good", ready: 96 },
  ];
  const dot = (tone: string) =>
    tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-400" : "bg-gold-400";
  return (
    <MockupFrame label="Firm console · Clients">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
          24 clients · Tax year 2026
        </div>
        <div className="text-[11px] text-ink-muted">2 need a nudge</div>
      </div>
      <ul className="mt-4 grid gap-2">
        {clients.map((c) => (
          <li
            key={c.name}
            className="flex items-center justify-between gap-3 rounded-lg bg-white border border-forest-100 px-3 py-2.5"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className={"size-2 rounded-full shrink-0 " + dot(c.tone)} />
              <span className="text-sm text-forest-900 truncate">{c.name}</span>
            </span>
            <span className="flex items-center gap-3 shrink-0">
              <span className="hidden sm:inline-block rounded-full bg-forest-50 overflow-hidden w-16 h-1.5">
                <span className="block h-full bg-gold-400" style={{ width: `${c.ready}%` }} />
              </span>
              <span className="text-[11px] text-forest-700 w-24 text-right">{c.status}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between text-[11px]">
        <span className="text-ink-muted">Follow-ups sent automatically to the quiet ones.</span>
        <span className="text-forest-700 uppercase tracking-[0.18em]">Bulk export</span>
      </div>
    </MockupFrame>
  );
}

// ---------------------------------------------------------------------------
// Proof band - concrete capability list, dark surface
// ---------------------------------------------------------------------------

function ProofBand() {
  const stats = [
    { kpi: "1,025", label: "IRS-cited deductions, auto-matched against every bank transaction" },
    { kpi: "1 hr", label: "Bank sync cadence - fully automatic" },
    { kpi: "Q1-Q4", label: "Quarterly safe-harbor reminders, two weeks early" },
    { kpi: "Face ID", label: "Passkey biometric sign-in on every device" },
  ];
  return (
    <section
      className="relative"
      style={{
        background:
          "linear-gradient(180deg, #1d2843 0%, #121a2a 100%)",
      }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-cream">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-300">
          Under the hood
        </div>
        <h2 className="display mt-3 text-3xl sm:text-4xl text-cream max-w-3xl">
          What is quietly running underneath.
        </h2>
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-6">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="display text-3xl sm:text-4xl text-cream gold-shine inline-block">
                {s.kpi}
              </div>
              <div className="mt-2 text-xs sm:text-sm text-cream/70 leading-relaxed">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FOMO band - pointed line + supporting texture
// ---------------------------------------------------------------------------

const FOMO: Record<Audience, { line: React.ReactNode; sub: string }> = {
  personal: {
    line: (
      <>
        Most of the deductions you have already earned are sitting{" "}
        <span className="gold-shine">in your bank statements.</span> We help you
        find them, gently, before tax day.
      </>
    ),
    sub: "We are not here to scare anyone about April. The tools are calm by design, the cadence is yours, and every number we surface is one you can verify against the IRS in a click.",
  },
  business: {
    line: (
      <>
        The deductions your business earned are hiding{" "}
        <span className="gold-shine">in your bank feed and your glovebox.</span>{" "}
        Taxottic surfaces them and files them away, all year.
      </>
    ),
    sub: "Running the business is hard enough. The books keep themselves, the miles track themselves, and the year-end return assembles itself, so the tax part is the part you stop thinking about.",
  },
  firm: {
    line: (
      <>
        Your firm&apos;s most thoughtful hours{" "}
        <span className="gold-shine">belong to your clients,</span> not to data
        entry. Taxottic gives those hours back to your team.
      </>
    ),
    sub: "Built by people who care about the work and the relationships behind it. We will never get between you and your clients. The tooling is yours; we just keep it tidy.",
  },
};

function FomoBand({ audience }: { audience: Audience }) {
  const f = FOMO[audience];
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        What we believe
      </div>
      <p className="display mt-4 text-3xl sm:text-5xl text-forest-900 leading-tight">
        {f.line}
      </p>
      <p className="mt-6 text-base sm:text-lg text-ink-soft max-w-2xl leading-relaxed">
        {f.sub}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

const FINAL_CTA: Record<
  Audience,
  {
    title: string;
    body: string;
    ctaHref: string;
    ctaLabel: string;
    others: { id: Audience; label: string }[];
  }
> = {
  personal: {
    title: "Take a look. Sign up only if it feels right.",
    body: "Connect an account in about 90 seconds and see your live federal + state forecast on the next page. No card. No commitment. Leave any time.",
    ctaHref: "/login",
    ctaLabel: "Take a look",
    others: [
      { id: "business", label: "I run a business" },
      { id: "firm", label: "I run a firm" },
    ],
  },
  business: {
    title: "Connect a bank. Watch the books keep themselves.",
    body: "About 90 seconds to sync, then your categorized expenses, tracked mileage, and live Schedule C forecast appear on their own. No card, no commitment.",
    ctaHref: "/login",
    ctaLabel: "Take a look",
    others: [
      { id: "personal", label: "Just my personal taxes" },
      { id: "firm", label: "I run a firm" },
    ],
  },
  firm: {
    title: "Tell us about your firm. We will tailor the rest.",
    body: "A short form, no sign-in required. We will reach out with a 15-minute walkthrough and a migration plan tailored to your client list.",
    ctaHref: "/book?for=firm",
    ctaLabel: "Open the form",
    others: [
      { id: "personal", label: "Just me" },
      { id: "business", label: "I run a business" },
    ],
  },
};

function FinalCta({ audience }: { audience: Audience }) {
  const c = FINAL_CTA[audience];
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-20 sm:pb-28">
      <div className="card p-6 sm:p-8 md:p-12 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="display text-2xl sm:text-3xl text-forest-900">
            {c.title}
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            {c.body}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 shrink-0">
          <Link href={c.ctaHref} className="btn-primary">
            {c.ctaLabel}
          </Link>
          {c.others.map((o) => (
            <Link
              key={o.id}
              href={`/?audience=${o.id}`}
              className="btn-ghost"
              scroll={false}
            >
              {o.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-forest-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid gap-8 sm:grid-cols-2">
        <div>
          <p className="text-xs text-ink-muted max-w-md leading-relaxed">
            Taxottic provides tax forecasting and educational guidance. It
            is not a substitute for advice from a licensed CPA or tax
            attorney.
          </p>
          <p className="mt-4 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-forest-100 bg-cream px-2.5 py-1">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-gold-500"
              />
              <span className="text-forest-800 font-medium">
                Made by{" "}
                <a
                  href="https://technooptics.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-forest-900"
                >
                  Techno Optics LLC
                </a>
              </span>
            </span>
          </p>
          <div className="mt-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700 mb-2">
              Get the app
            </div>
            <AppStoreBadges />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-ink-muted sm:justify-self-end sm:text-right">
          {/* Two columns: "Product" (live, conversion-critical pages)
              and "Legal" (compliance surface). Surfaces every page the
              May 2026 audit said should be discoverable from the home
              page, pricing, help, changelog, example, plus the legal
              hub items. */}
          <div className="grid gap-2 sm:order-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
              Product
            </span>
            <Link href="/pricing" className="hover:text-forest-700">
              Pricing
            </Link>
            <Link href="/example" className="hover:text-forest-700">
              Example
            </Link>
            <Link href="/help" className="hover:text-forest-700">
              Help
            </Link>
            <Link href="/guides" className="hover:text-forest-700">
              Guides
            </Link>
            <Link href="/calculators" className="hover:text-forest-700">
              Free calculators
            </Link>
            <Link href="/compare" className="hover:text-forest-700">
              Compare
            </Link>
            <Link href="/changelog" className="hover:text-forest-700">
              Changelog
            </Link>
            <Link href="/book?for=firm" className="hover:text-forest-700">
              For firms
            </Link>
            <Link href="/login" className="hover:text-forest-700">
              Sign in
            </Link>
          </div>
          <div className="grid gap-2 sm:order-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-gold-700">
              Legal
            </span>
            <Link href="/legal" className="hover:text-forest-700">
              Legal hub
            </Link>
            <Link href="/legal/privacy" className="hover:text-forest-700">
              Privacy
            </Link>
            <Link href="/legal/terms" className="hover:text-forest-700">
              Terms
            </Link>
            <Link href="/legal/security" className="hover:text-forest-700">
              Security
            </Link>
            <Link
              href="/legal/subprocessors"
              className="hover:text-forest-700"
            >
              Subprocessors
            </Link>
            <Link
              href="/legal/accessibility"
              className="hover:text-forest-700"
            >
              Accessibility
            </Link>
            <Link href="/legal/dmca" className="hover:text-forest-700">
              DMCA
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
