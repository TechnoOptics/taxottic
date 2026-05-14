export const metadata = { title: "Subprocessors - Taxottic" };

type Sub = {
  name: string;
  role: string;
  data: string;
  region: string;
  certs: string;
  url: string;
};

const SUBPROCESSORS: Sub[] = [
  {
    name: "Vercel",
    role: "Hosting + CDN for the Taxottic web app.",
    data: "HTTP request metadata, IP at request time (not stored long-term).",
    region: "United States (global edge for static assets).",
    certs: "SOC 2 Type II, ISO 27001, GDPR-aligned DPA.",
    url: "https://vercel.com/legal/privacy-policy",
  },
  {
    name: "Supabase",
    role: "Postgres database, authentication, storage of user files.",
    data: "All application data (tax profiles, expenses, conversations, bank metadata).",
    region: "United States (AWS us-east-1).",
    certs: "SOC 2 Type II, HIPAA-eligible, GDPR-aligned DPA.",
    url: "https://supabase.com/privacy",
  },
  {
    name: "Plaid",
    role: "Bank connectivity, transaction sync.",
    data: "Bank account ID, transaction merchant + date + amount, institution name. Bank credentials are entered into Plaid's UI and never reach Taxottic.",
    region: "United States.",
    certs: "SOC 2 Type II, ISO 27001:2013, AICPA SOC for Service Organisations.",
    url: "https://plaid.com/legal/",
  },
  {
    name: "Anthropic",
    role: "Powers Bella, our in-app AI tax guide.",
    data: "Messages you send to Bella + minimal account context (display name, plan tier).",
    region: "United States.",
    certs: "SOC 2 Type II. Enterprise agreement: zero data retention for training.",
    url: "https://www.anthropic.com/legal/privacy",
  },
  {
    name: "Stripe",
    role: "Subscription billing for paid tiers.",
    data: "Email, billing address, last-four card digits via Stripe-hosted checkout. Full card numbers never reach Taxottic.",
    region: "United States.",
    certs: "PCI DSS Level 1, SOC 1 / SOC 2 Type II, ISO 27001.",
    url: "https://stripe.com/privacy",
  },
  {
    name: "Google",
    role: "Optional sign-in via Google OAuth.",
    data: "Name, email, profile photo from the openid email profile scopes.",
    region: "United States.",
    certs: "ISO 27001, SOC 2/3, FedRAMP.",
    url: "https://policies.google.com/privacy",
  },
  {
    name: "Microsoft",
    role: "Optional sign-in via Microsoft Identity Platform.",
    data: "Name, email, profile photo from the openid email profile scopes.",
    region: "United States and EU (per Microsoft's regional model).",
    certs: "SOC 1/2/3, ISO 27001, FedRAMP.",
    url: "https://privacy.microsoft.com/en-us/privacystatement",
  },
];

export default function SubprocessorsPage() {
  return (
    <main id="main" className="min-h-screen">
      <section className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Subprocessors
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Who else processes your data.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Last updated: 2026-05-04
        </p>

        <p className="mt-6 text-sm text-ink-soft leading-relaxed max-w-2xl">
          To run Taxottic we rely on a short, vetted list of vendors. We
          do not engage a new subprocessor without first reviewing their
          security practices and data-protection commitments. We update
          this page when we add or change a vendor and announce material
          changes in-app at least 30 days before they take effect.
        </p>

        <div className="mt-8 grid gap-3">
          {SUBPROCESSORS.map((s) => (
            <article
              key={s.name}
              className="card p-5 sm:p-6 grid gap-3"
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h2 className="display text-xl text-forest-900">{s.name}</h2>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-forest-700 hover:text-forest-900 underline underline-offset-2"
                >
                  Their privacy notice ↗
                </a>
              </div>
              <Row label="Role" value={s.role} />
              <Row label="Data processed" value={s.data} />
              <Row label="Region" value={s.region} />
              <Row label="Certifications" value={s.certs} />
            </article>
          ))}
        </div>

        <p className="mt-10 text-xs text-ink-muted leading-relaxed max-w-2xl">
          Want a Data Processing Agreement (DPA)? See our standard
          template at{" "}
          <a href="/legal/dpa" className="underline hover:text-forest-900">
            /legal/dpa
          </a>
          , or write to{" "}
          <a href="mailto:privacy@taxottic.com" className="underline hover:text-forest-900">
            privacy@taxottic.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid sm:grid-cols-[140px_1fr] gap-1 sm:gap-3 text-sm">
      <div className="text-[11px] uppercase tracking-[0.18em] text-gold-700 sm:pt-0.5">
        {label}
      </div>
      <div className="text-ink-soft leading-relaxed">{value}</div>
    </div>
  );
}
