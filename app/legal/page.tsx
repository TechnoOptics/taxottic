import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";

export const metadata = {
  title: "Legal — privacy, security, terms, DPA, DMCA, accessibility",
  description:
    "Plain-English policies for Taxottic. Privacy, security overview, terms of service, DPA, subprocessors, cookies, DMCA, accessibility, acceptable use.",
  alternates: { canonical: "/legal" },
  openGraph: {
    title: "Taxottic Legal",
    description:
      "Plain-English privacy, security, terms, DPA, subprocessors, DMCA, and accessibility policies.",
    url: "/legal",
    type: "website",
  },
};

const LEGAL_BREADCRUMB_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://taxottic.com/",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Legal",
      item: "https://taxottic.com/legal",
    },
  ],
};

const PAGES = [
  { href: "/legal/privacy", title: "Privacy Policy", body: "What we collect, why, where it lives, and how to ask for it back." },
  { href: "/legal/terms", title: "Terms of Service", body: "The agreement between you and Techno Optics LLC for using Taxottic." },
  { href: "/legal/security", title: "Security Overview", body: "How we encrypt, isolate, monitor, and respond to incidents." },
  { href: "/legal/subprocessors", title: "Subprocessors", body: "The vendors that process customer data on our behalf." },
  { href: "/legal/cookies", title: "Cookie Policy", body: "Just the cookies we need for sign-in, passkeys, and consent." },
  { href: "/legal/acceptable-use", title: "Acceptable Use Policy", body: "What we ask of you when you use the service." },
  { href: "/legal/dpa", title: "Data Processing Agreement", body: "Standard DPA for firm and business customers." },
  { href: "/legal/dmca", title: "DMCA Policy", body: "How to send a copyright notice or counter-notice for content on Taxottic." },
  { href: "/legal/accessibility", title: "Accessibility", body: "Our WCAG 2.2 AA commitment, what's in place today, and how to report a barrier." },
];

export default function LegalIndex() {
  return (
    <main id="main" className="min-h-screen">
      <JsonLd data={LEGAL_BREADCRUMB_LD} />
      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Legal
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Plain-English policies.
        </h1>
        <p className="mt-3 text-sm text-ink-soft max-w-2xl leading-relaxed">
          We treat policies the way we treat the rest of the product: clear,
          honest, and short enough to read on a Tuesday. Questions any time
          to{" "}
          <a href="mailto:privacy@taxottic.com" className="underline hover:text-forest-900">
            privacy@taxottic.com
          </a>
          .
        </p>

        <ul className="mt-8 grid gap-3">
          {PAGES.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                className="card card-hover p-5 sm:p-6 grid gap-1 hover:border-gold-300/60"
              >
                <div className="display text-xl text-forest-900">{p.title}</div>
                <div className="text-sm text-ink-soft leading-relaxed">{p.body}</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
