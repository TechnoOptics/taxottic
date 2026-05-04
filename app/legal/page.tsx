import Link from "next/link";

export const metadata = { title: "Legal - Taxottic" };

const PAGES = [
  { href: "/legal/privacy", title: "Privacy Policy", body: "What we collect, why, where it lives, and how to ask for it back." },
  { href: "/legal/terms", title: "Terms of Service", body: "The agreement between you and Techno Optics LLC for using Taxottic." },
  { href: "/legal/security", title: "Security Overview", body: "How we encrypt, isolate, monitor, and respond to incidents." },
  { href: "/legal/subprocessors", title: "Subprocessors", body: "The vendors that process customer data on our behalf." },
  { href: "/legal/cookies", title: "Cookie Policy", body: "Just the cookies we need for sign-in, passkeys, and consent." },
  { href: "/legal/acceptable-use", title: "Acceptable Use Policy", body: "What we ask of you when you use the service." },
  { href: "/legal/dpa", title: "Data Processing Agreement", body: "Standard DPA for firm and business customers." },
];

export default function LegalIndex() {
  return (
    <main className="min-h-screen">
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
