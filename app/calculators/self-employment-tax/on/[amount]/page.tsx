import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import { SelfEmploymentTaxCalculator } from "@/components/calculators/SelfEmploymentTaxCalculator";
import { formatCents } from "@/lib/tax/forecast";
import {
  CALC_INCOMES,
  parseIncomeSlug,
  incomeSnapshot,
  formatDollars,
} from "@/lib/calculators/incomes";

const SITE = "https://taxottic.com";
const BASE = "/calculators/self-employment-tax";

type Params = Promise<{ amount: string }>;

// Prerender the curated set of income breakpoints; nothing else resolves.
export function generateStaticParams() {
  return CALC_INCOMES.map((n) => ({ amount: String(n) }));
}

// Only the curated amounts are valid pages, any other number returns a
// real 404 instead of dynamically minting an unbounded doorway page.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { amount } = await params;
  const gross = parseIncomeSlug(amount);
  if (gross == null) return {};
  const snap = incomeSnapshot(gross);
  const money = formatDollars(gross);
  const title = `Self-Employment Tax on ${money} (2026), What You'll Owe`;
  const description = `On ${money} of self-employment income you'll owe about ${formatCents(
    snap.totalTaxCents,
  )} in 2026, ${formatCents(
    snap.selfEmploymentTaxCents,
  )} self-employment tax plus federal income tax, an effective rate near ${(
    snap.effectiveRate * 100
  ).toFixed(1)}%. Free breakdown + calculator, no sign-up.`;
  const ogUrl = `/api/og/calc?calc=se-tax&income=${gross}`;
  const canonical = `${BASE}/on/${gross}`;
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
      `self-employment tax on ${gross}`,
      `self employment tax ${money}`,
      `how much tax on ${gross} self employed`,
      `1099 tax on ${money}`,
      `taxes on ${money} self employed`,
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

export default async function IncomeSelfEmploymentTaxPage({
  params,
}: {
  params: Params;
}) {
  const { amount } = await params;
  const gross = parseIncomeSlug(amount);
  if (gross == null) notFound();
  const snap = incomeSnapshot(gross);
  const money = formatDollars(gross);
  const setAsidePct = Math.round(snap.setAsideFraction * 100);

  // The breakdown rows, only show QBI when it's non-zero (it phases in
  // with profit), so lower-income pages don't show a $0 line.
  const rows: { label: string; value: string; hint?: string }[] = [
    {
      label: "Self-employment tax (15.3%)",
      value: formatCents(snap.selfEmploymentTaxCents),
      hint: "Social Security + Medicare on 92.35% of net profit",
    },
    {
      label: "Federal income tax",
      value: formatCents(snap.federalIncomeTaxCents),
      hint: "After the standard deduction and the 1/2-SE-tax adjustment",
    },
  ];
  if (snap.qbiDeductionCents > 0) {
    rows.push({
      label: "Qualified business income deduction",
      value: `- ${formatCents(snap.qbiDeductionCents)}`,
      hint: "The 20% QBI deduction, already reflected in the income tax above",
    });
  }

  const faqs = [
    {
      q: `How much self-employment tax do I pay on ${money}?`,
      a: `On ${money} of net self-employment profit, the self-employment tax alone is about ${formatCents(
        snap.selfEmploymentTaxCents,
      )}, that's 15.3% (12.4% Social Security + 2.9% Medicare) on 92.35% of your profit. Add federal income tax and your total 2026 federal tax is roughly ${formatCents(
        snap.totalTaxCents,
      )}. Your state, business expenses, and other income can move this up or down, the calculator above lets you add them.`,
    },
    {
      q: `What's my effective tax rate on ${money} self-employed?`,
      a: `About ${(snap.effectiveRate * 100).toFixed(
        1,
      )}% at the federal level on this income as a single filer with no state tax, meaning roughly ${formatCents(
        snap.afterTaxCents,
      )} is left after federal tax. Effective rate rises with income because more of it lands in higher brackets.`,
    },
    {
      q: `How much should I set aside for taxes on ${money}?`,
      a: `Setting aside about ${setAsidePct}% of what you earn covers the ${formatCents(
        snap.totalTaxCents,
      )} you'd owe here. A common safe rule is 25-30% for most self-employed incomes; this page's ${setAsidePct}% is the exact figure for ${money}. Your next quarterly estimate would be around ${formatCents(
        snap.quarterlyCents,
      )}.`,
    },
  ];

  const BREADCRUMB_LD = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Calculators",
        item: `${SITE}/calculators`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "Self-Employment Tax",
        item: `${SITE}${BASE}`,
      },
      {
        "@type": "ListItem",
        position: 4,
        name: `On ${money}`,
        item: `${SITE}${BASE}/on/${gross}`,
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
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
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
          <span className="text-forest-800">On {money}</span>
        </nav>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700 mt-6">
          Free calculator · 2026
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight max-w-3xl">
          Self-Employment Tax on {money}
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          On {money} of net self-employment profit, a single filer owes about{" "}
          <strong className="text-forest-900">
            {formatCents(snap.totalTaxCents)}
          </strong>{" "}
          in 2026 federal tax, roughly a {(snap.effectiveRate * 100).toFixed(1)}%
          effective rate. Here&rsquo;s the breakdown, then add your state and
          expenses below.
        </p>
      </section>

      {/* Computed breakdown, the substance that makes each income page a
          real answer rather than a templated shell. */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
        <div className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="display text-lg text-forest-900">
                What you owe on {money}
              </h2>
              <p className="text-xs text-ink-muted mt-1">
                Estimated 2026 federal tax · single filer · no state tax
              </p>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wider text-gold-700">
                Total federal tax
              </div>
              <div className="display text-3xl text-forest-900 tabular-nums">
                {formatCents(snap.totalTaxCents)}
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-2.5">
            {rows.map((r) => (
              <div
                key={r.label}
                className="flex items-baseline justify-between gap-4 border-t border-forest-100 pt-2.5"
              >
                <div>
                  <div className="text-sm text-forest-900">{r.label}</div>
                  {r.hint ? (
                    <div className="text-xs text-ink-muted mt-0.5">{r.hint}</div>
                  ) : null}
                </div>
                <div className="text-sm tabular-nums text-forest-900 whitespace-nowrap">
                  {r.value}
                </div>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t-2 border-forest-200 pt-3 mt-1">
              <div className="text-sm font-medium text-forest-900">
                After-tax take-home
              </div>
              <div className="text-sm font-medium tabular-nums text-forest-900">
                {formatCents(snap.afterTaxCents)}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink-soft">
            <span>
              Effective rate:{" "}
              <strong className="text-forest-900">
                {(snap.effectiveRate * 100).toFixed(1)}%
              </strong>
            </span>
            <span>
              Set aside:{" "}
              <strong className="text-forest-900">{setAsidePct}%</strong> of
              income
            </span>
            <span>
              Next quarterly ≈{" "}
              <strong className="text-forest-900">
                {formatCents(snap.quarterlyCents)}
              </strong>
            </span>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <SelfEmploymentTaxCalculator initial={{ income: String(gross) }} />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div>
          <h2 className="display text-2xl text-forest-900">
            How the tax on {money} breaks down
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            Self-employment tax comes first: 15.3% on 92.35% of your net profit,
            which on {money} is about {formatCents(snap.selfEmploymentTaxCents)}.
            You then owe federal income tax on your profit, but after the
            standard deduction, the deduction for half your self-employment tax,
            and the QBI deduction where it applies. That&rsquo;s why your
            effective rate ({(snap.effectiveRate * 100).toFixed(1)}%) is well
            below your top bracket. State income tax, business expenses,
            retirement contributions, and a spouse&rsquo;s income all change the
            final number &mdash;
            add them in the calculator above to see your own figure.
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
            Other amounts
          </div>
          <h2 className="display text-xl text-forest-900 mt-1">
            Self-employment tax by income
          </h2>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {CALC_INCOMES.filter((n) => n !== gross).map((n) => (
              <Link
                key={n}
                href={`${BASE}/on/${n}`}
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                {formatDollars(n)}
              </Link>
            ))}
          </div>
          <div className="mt-4 text-sm">
            <Link
              href={BASE}
              className="text-forest-800 hover:text-forest-900 underline underline-offset-2"
            >
              Full self-employment tax calculator →
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
