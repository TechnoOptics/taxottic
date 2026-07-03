import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  PLAN_PRICING,
  type SubscriptionPriceKey,
} from "@/lib/plans/limits";

// -------------------------------------------------------------------
// JSON-LD structured data for the home page.
//
// Four blobs:
//   1. Organization      — who's behind Taxottic (Techno Optics LLC).
//                          Shows up in knowledge panels.
//   2. WebSite           — site identity + the sitelinks searchbox
//                          target (?q=...). Lets Google render a
//                          search box under the homepage SERP card.
//   3. SoftwareApplication — that we're a finance SaaS, with the full
//                          subscription tier list as Offers. Eligible
//                          for the rich "app" treatment Google gives
//                          finance products.
//   4. SiteNavigationElement — the primary nav so Google can build
//                          sitelinks correctly.
//
// Schemas tested in https://search.google.com/test/rich-results before
// shipping. Don't add aggregateRating or review schema until we have
// real review sources to cite — fabricating either is a guidelines
// violation that risks a manual action.
// -------------------------------------------------------------------

const SITE_ORIGIN = "https://taxottic.com";

function buildSoftwareApplicationOffers() {
  // Surface every paid tier as an Offer so Google sees the price range
  // accurately. The Free tier is omitted from Offers (price 0 with a
  // payment vehicle is a guidelines violation — Free isn't a
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
  // so this is commented out — uncomment when /help-style site
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
  description:
    "Tax forecasting software for freelancers, sole proprietors, and small businesses. Bank-synced quarterly estimates, 1,025 IRS-cited deductions, Schedule C export, AMT and QBI math, multi-state.",
  // No aggregateRating until we have real reviews to cite.
  // No award until awards exist.
  publisher: { "@id": `${SITE_ORIGIN}/#organization` },
  // `offers` (plural) when there's more than one — Google handles
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

// DefinedTerm — the closest legitimate equivalent of a "dictionary
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

type Audience = "personal" | "enterprise";

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
  const audience: Audience =
    sp.audience === "enterprise" ? "enterprise" : "personal";

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

      {/* Forest header band - visually merges into the Hero gradient below
          so the page opens with one continuous premium-green field. Same
          gradient + gold underline as the authenticated AppHeader, so the
          marketing site feels like the same product the user signs into. */}
      <header
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
          borderBottom: "1px solid rgba(213, 187, 126, 0.14)",
          // Native iOS draws the WebView UNDER the status bar
          // (capacitor.config.ts StatusBar.overlaysWebView), so without
          // a top inset the wordmark/"Sign in" land beneath the notch /
          // Dynamic Island. Pad by the real safe-area inset — same
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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
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

      <Hero audience={audience} />
      <Capabilities audience={audience} />
      <ProductTour />
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

function Hero({ audience }: { audience: Audience }) {
  const personal = audience === "personal";
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
          {personal ? (
            <>
              A calmer way to{" "}
              <span className="gold-shine">handle your taxes.</span>
            </>
          ) : (
            <>
              A calmer view of{" "}
              <span className="gold-shine">every client&apos;s books.</span>
            </>
          )}
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-cream/80 max-w-2xl leading-relaxed">
          {personal ? (
            <>
              Taxottic quietly tracks the deductions your business has already
              earned, keeps a running forecast in step with your bank, and
              gives you a gentle nudge to set money aside before you need it.
              Built for freelancers, contractors, and small businesses.
            </>
          ) : (
            <>
              A shared workspace where your clients keep their books in order
              on their own time, and your team picks up where they left off.
              Branded as your firm, never as ours.
            </>
          )}
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          {/* "Take a look around" used to point at /login, which the
              May 2026 audit (P2) flagged as a soft-claim: the copy
              promises a tour, the link asks for a sign-up. /example is
              now a real read-only sample dashboard so the CTA matches
              its words. Firm-side keeps booking as the right CTA. */}
          <Link
            href={personal ? "/example" : "/book?for=firm"}
            className="btn-primary"
          >
            {personal ? "Take a look around" : "Have a quick chat"}
          </Link>
          <Link
            href={personal ? "/pricing" : "/pricing#practice"}
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
          {personal
            ? "No credit card. No commitment. Visit and leave at your own pace."
            : "White-glove migration. Branded portal. Per-seat or per-client."}
        </p>
      </div>
    </section>
  );
}

function AudienceToggle({ audience }: { audience: Audience }) {
  const segments: { id: Audience; label: string }[] = [
    { id: "personal", label: "For me" },
    { id: "enterprise", label: "For my firm" },
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

const ENTERPRISE: Capability[] = [
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

function Capabilities({ audience }: { audience: Audience }) {
  const items = audience === "personal" ? PERSONAL : ENTERPRISE;
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        What you get
      </div>
      <h2 className="display mt-3 text-3xl sm:text-5xl text-forest-900 max-w-3xl">
        {audience === "personal"
          ? "Built so the tax part of your business stops feeling like the scary part."
          : "Built so your firm operates the way clients already think it does."}
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

function ProductTour() {
  return (
    <section className="bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          See it on Company X
        </div>
        <h2 className="display mt-3 text-3xl sm:text-5xl text-forest-900 max-w-3xl">
          A real software company,{" "}
          <span className="gold-shine">the calm way.</span>
        </h2>
        <p className="mt-4 text-base sm:text-lg text-ink-soft max-w-2xl leading-relaxed">
          Company X connected one bank account on a Tuesday. By Friday,
          their Q4 forecast, deductible expenses, and a ready-to-file
          Schedule C were quietly waiting in the dashboard. No spreadsheet
          opened, no inbox checked twice.
        </p>

        <div className="mt-14 grid gap-16">
          <Row reverse={false}>
            <BankFeedMockup />
            <Caption
              kicker="Hour 1 - Bank sync"
              title="The bank does the heavy lifting."
              body="Your bank feed keeps every active account in step every hour. New transactions land tagged against the full 1,025-item IRS deduction catalog, IRC section cited, source URL one tap away. One tap to apply, dismiss, or split when you have the moment."
              tags={["Hourly bank sync", "1,025 IRS-cited deductions", "Auto-applied"]}
            />
          </Row>

          <Row reverse={true}>
            <Caption
              kicker="Hour 2 - Live forecast"
              title="The forecast keeps pace, quietly."
              body="Federal and state brackets, applied to live YTD income and the deductions Company X has claimed. The number in the corner of every screen moves with the math; no nightly recompute, no refreshing required."
              tags={["Federal + state", "Quarterly safe-harbor", "Updated automatically"]}
            />
            <ForecastMockup />
          </Row>

          <Row reverse={false}>
            <ScheduleCMockup />
            <Caption
              kicker="December - Year-end"
              title="One click brings the whole Schedule C together."
              body="Every applied transaction lands on its proper Schedule C line. Bella applies the meals 50% rule. Vehicle expenses split between standard mileage and actual. Everything cited to the IRS publication, ready to hand to your CPA when you're ready."
              tags={["Schedule C", "IRS-cited", "PDF + CSV"]}
            />
          </Row>
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

function FomoBand({ audience }: { audience: Audience }) {
  const personal = audience === "personal";
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        What we believe
      </div>
      <p className="display mt-4 text-3xl sm:text-5xl text-forest-900 leading-tight">
        {personal ? (
          <>
            Most of the deductions you have already earned are sitting{" "}
            <span className="gold-shine">in your bank statements.</span> We
            help you find them, gently, before tax day.
          </>
        ) : (
          <>
            Your firm&apos;s most thoughtful hours{" "}
            <span className="gold-shine">belong to your clients,</span> not to
            data entry. Taxottic gives those hours back to your team.
          </>
        )}
      </p>
      <p className="mt-6 text-base sm:text-lg text-ink-soft max-w-2xl leading-relaxed">
        {personal
          ? "We are not here to scare anyone about April. The tools are calm by design, the cadence is yours, and every number we surface is one you can verify against the IRS in a click."
          : "Built by people who care about the work and the relationships behind it. We will never get between you and your clients. The tooling is yours; we just keep it tidy."}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

function FinalCta({ audience }: { audience: Audience }) {
  const personal = audience === "personal";
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-20 sm:pb-28">
      <div className="card p-6 sm:p-8 sm:p-12 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="display text-2xl sm:text-3xl text-forest-900">
            {personal
              ? "Take a look. Sign up only if it feels right."
              : "Tell us about your firm. We will tailor the rest."}
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            {personal
              ? "Connect a bank in about 90 seconds and see your live federal + state forecast on the next page. No card. No commitment. Leave any time."
              : "A short form, no sign-in required. We will reach out with a 15-minute walkthrough and a migration plan tailored to your client list."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 shrink-0">
          <Link
            href={personal ? "/login" : "/book?for=firm"}
            className="btn-primary"
          >
            {personal ? "Take a look" : "Open the form"}
          </Link>
          <Link
            href={`/?audience=${personal ? "enterprise" : "personal"}`}
            className="btn-ghost"
            scroll={false}
          >
            {personal ? "I run a firm" : "I am an individual"}
          </Link>
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
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-ink-muted sm:justify-self-end sm:text-right">
          {/* Two columns: "Product" (live, conversion-critical pages)
              and "Legal" (compliance surface). Surfaces every page the
              May 2026 audit said should be discoverable from the home
              page — pricing, help, changelog, example, plus the legal
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
