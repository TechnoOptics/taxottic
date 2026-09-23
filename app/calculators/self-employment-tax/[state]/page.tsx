import { MarketingNav } from "@/components/MarketingNav";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import { SelfEmploymentTaxCalculator } from "@/components/calculators/SelfEmploymentTaxCalculator";
import { formatCents } from "@/lib/tax/forecast";
import { CALC_STATES, stateBySlug, stateSnapshot } from "@/lib/calculators/states";

const SITE = "https://taxottic.com";
const BASE = "/calculators/self-employment-tax";

type Params = Promise<{ state: string }>;

// Static-generate all 50 states + DC at build time, fast, cached, and
// ideal for SEO (every state URL is a real prerendered page).
export function generateStaticParams() {
  return CALC_STATES.map((s) => ({ state: s.slug }));
}

// Only the 51 generated slugs are valid, any other slug returns a real
// 404 from the framework instead of dynamically rendering a shell. Keeps
// crawlers from ever indexing a garbage state URL.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { state } = await params;
  const st = stateBySlug(state);
  if (!st) return {};
  const title = `Self-Employment Tax in ${st.name} (2026), Calculator`;
  const snap = stateSnapshot(st.code);
  const description = snap.hasIncomeTax
    ? `How much self-employment tax you'll owe in ${st.name}: federal self-employment tax (15.3%) plus federal and ${st.name} state income tax. Free calculator with real ${st.name} numbers, no sign-up.`
    : `${st.name} has no state income tax, so a self-employed ${st.name} resident owes only federal income tax and self-employment tax (15.3%). Free calculator with real numbers, no sign-up.`;
  const ogUrl = `/api/og/calc?calc=se-tax&label=${encodeURIComponent(
    `Self-Employment Tax · ${st.name}`,
  )}`;
  const canonical = `${BASE}/${st.slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
    keywords: [
      `self-employment tax ${st.name}`,
      `${st.name} self employment tax calculator`,
      `1099 taxes ${st.name}`,
      `self employed tax ${st.name}`,
      `does ${st.name} have income tax`,
    ],
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-snippet": -1,
        "max-image-preview": "large",
      },
    },
  };
}

export default async function StateSelfEmploymentTaxPage({
  params,
}: {
  params: Params;
}) {
  const { state } = await params;
  const st = stateBySlug(state);
  if (!st) notFound();
  const snap = stateSnapshot(st.code);

  const faqs = [
    {
      q: `Does ${st.name} have a state income tax for the self-employed?`,
      a: snap.hasIncomeTax
        ? `Yes. On top of federal income tax and the 15.3% self-employment tax, ${st.name} taxes your self-employment income at its state rates. On a $100,000 self-employed income, ${st.name}'s income tax works out to roughly ${(snap.stateBiteAt100k * 100).toFixed(1)}% of income in this estimate.`
        : `No. ${st.name} has no personal income tax on earned income, so a self-employed ${st.name} resident owes only federal income tax and the 15.3% self-employment tax, there's no state income tax to add on top.`,
    },
    {
      q: `How much self-employment tax will I owe in ${st.name}?`,
      a: `Self-employment tax itself is the same everywhere, 15.3% of 92.35% of your net profit, for Social Security and Medicare. What changes by state is the income-tax layer on top. Use the calculator above with your own numbers${
        snap.hasIncomeTax ? `; it already applies ${st.name}'s brackets.` : `; ${st.name} adds no state income tax.`
      }`,
    },
    {
      q: `Do I pay quarterly estimated taxes in ${st.name}?`,
      a: `If you expect to owe $1,000 or more in federal tax, the IRS wants quarterly estimated payments (mid-April, June, September, and January).${
        snap.hasIncomeTax
          ? ` ${st.name} generally has its own quarterly estimates too when you owe state tax.`
          : ` Since ${st.name} has no income tax, you only manage the federal quarterly payments.`
      } The calculator shows your next federal quarterly amount.`,
    },
  ];

  const BREADCRUMB_LD = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Calculators", item: `${SITE}/calculators` },
      {
        "@type": "ListItem",
        position: 3,
        name: "Self-Employment Tax",
        item: `${SITE}${BASE}`,
      },
      {
        "@type": "ListItem",
        position: 4,
        name: st.name,
        item: `${SITE}${BASE}/${st.slug}`,
      },
    ],
  };

  const FAQ_LD = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <JsonLd data={BREADCRUMB_LD} />
      <JsonLd data={FAQ_LD} />

      <header
        className="relative"
        style={{
          background:
            "var(--navy-band)",
          paddingTop:
            "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <Wordmark size="md" tone="cream" />
          <MarketingNav current="calculators" />
          <SignInIconLink />
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-2">
        <nav
          aria-label="Breadcrumb"
          className="text-xs text-ink-muted flex items-center gap-1.5 flex-wrap"
        >
          <Link href="/" className="hover:text-forest-900">
            Home
          </Link>
          <span aria-hidden="true">/</span>
          <Link href="/calculators" className="hover:text-forest-900">
            Calculators
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={BASE} className="hover:text-forest-900">
            Self-employment tax
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-forest-800">{st.name}</span>
        </nav>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700 mt-6">
          Free calculator · 2026
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight max-w-3xl">
          Self-Employment Tax in {st.name}
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          {snap.hasIncomeTax
            ? `What a freelancer or 1099 contractor really owes in ${st.name}, the 15.3% self-employment tax, federal income tax, and ${st.name}'s state income tax. Real numbers, instant, no sign-up.`
            : `${st.name} has no state income tax, so a self-employed ${st.name} resident owes only federal income tax and the 15.3% self-employment tax. See your number instantly, no sign-up.`}
        </p>
      </section>

      {/* Real, per-state computed example table, the substance that makes
          each state page unique rather than a templated shell. */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
        <div className="card p-5 sm:p-6">
          <h2 className="display text-lg text-forest-900">
            What {st.name} self-employed taxes look like
          </h2>
          <p className="text-xs text-ink-muted mt-1">
            Estimated 2026 total tax for a single filer, net self-employment
            profit, {st.name}.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gold-700">
                  <th className="pb-2 font-medium">Net profit</th>
                  <th className="pb-2 font-medium">Total tax</th>
                  {snap.hasIncomeTax ? (
                    <th className="pb-2 font-medium">{st.name} state tax</th>
                  ) : null}
                  <th className="pb-2 font-medium">Effective rate</th>
                </tr>
              </thead>
              <tbody className="text-forest-900">
                {snap.examples.map((e) => (
                  <tr key={e.netDollars} className="border-t border-forest-100">
                    <td className="py-2.5 tabular-nums">
                      {formatCents(e.netDollars * 100)}
                    </td>
                    <td className="py-2.5 tabular-nums font-medium">
                      {formatCents(e.totalTaxCents)}
                    </td>
                    {snap.hasIncomeTax ? (
                      <td className="py-2.5 tabular-nums">
                        {formatCents(e.stateTaxCents)}
                      </td>
                    ) : null}
                    <td className="py-2.5 tabular-nums text-ink-soft">
                      {(e.effectiveRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <SelfEmploymentTaxCalculator initial={{ state: st.code }} />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div>
          <h2 className="display text-2xl text-forest-900">
            {st.name} self-employment tax, in plain terms
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            Self-employment tax, 15.3% of your net earnings for Social Security
            and Medicare, is federal and the same in every state. What differs
            in {st.name} is the income-tax layer.{" "}
            {snap.hasIncomeTax
              ? `${st.name} taxes your self-employment profit at its own rates on top of federal income tax, so your all-in effective rate runs a few points higher than in a no-income-tax state. The calculator above already applies ${st.name}'s brackets, so the number you see is the real one.`
              : `Because ${st.name} has no personal income tax, your only two layers are federal income tax and self-employment tax, nothing at the state level. That makes ${st.name} one of the lighter states for self-employed taxes, though you still owe the full federal SE tax.`}
          </p>
        </div>

        <div>
          <h2 className="display text-2xl text-forest-900">Frequently asked</h2>
          <div className="mt-4 grid gap-4">
            {faqs.map((f) => (
              <div key={f.q} className="card p-5">
                <h3 className="text-base font-medium text-forest-900">{f.q}</h3>
                <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                  {f.a}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-6 border-gold-300/60">
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
            Other states
          </div>
          <h2 className="display text-xl text-forest-900 mt-1">
            Self-employment tax by state
          </h2>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {CALC_STATES.filter((s) => s.code !== st.code)
              .slice(0, 14)
              .map((s) => (
                <Link
                  key={s.code}
                  href={`${BASE}/${s.slug}`}
                  className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
                >
                  {s.name}
                </Link>
              ))}
            <Link
              href={BASE}
              className="text-forest-800 hover:text-forest-900 underline underline-offset-2"
            >
              All states →
            </Link>
          </div>
          <div className="mt-4 pt-4 border-t border-forest-100 text-sm text-ink-soft">
            Related reading:{" "}
            <Link
              href="/guides/self-employment-tax-how-much-to-set-aside"
              className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
            >
              how much to set aside
            </Link>{" "}
            ·{" "}
            <Link
              href="/guides/quarterly-estimated-taxes-explained"
              className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
            >
              quarterly estimated taxes
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
