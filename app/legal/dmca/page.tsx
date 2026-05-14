import Link from "next/link";

export const metadata = {
  title: "DMCA Policy — Taxottic copyright notice & counter-notice",
  description:
    "How to submit a DMCA copyright notice or counter-notice for content on Taxottic. Designated agent, required fields, repeat-infringer policy.",
  alternates: { canonical: "/legal/dmca" },
  openGraph: {
    title: "Taxottic DMCA Policy",
    description:
      "DMCA notice-and-takedown procedure, designated agent, counter-notice template.",
    url: "/legal/dmca",
    type: "article",
  },
};

// DMCA-style takedown policy. Required for safe-harbour treatment under
// 17 U.S.C. § 512(c) on any path where a user can upload content
// (company logos, receipts, attached documents, etc.). The agent-
// designation step lives off-document (we register a designated agent
// with the U.S. Copyright Office); the on-page parts are the policy
// itself, the notice template, the counter-notice template, and the
// repeat-infringer rule.
export default function DmcaPage() {
  return (
    <main id="main" className="min-h-screen">
      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          DMCA Policy
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Copyright complaints &amp; counter-notices.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Effective: 2026-05-12 · Last updated: 2026-05-12 · Questions:{" "}
          <a
            href="mailto:dmca@taxottic.com"
            className="underline hover:text-forest-900"
          >
            dmca@taxottic.com
          </a>
        </p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <Section title="Plain-English summary">
            <p>
              If you own a copyright and you believe a file uploaded to
              Taxottic infringes it, you can send us a notice and we will
              promptly remove or disable access to the file. If you
              believe content of yours was removed by mistake, you can
              send us a counter-notice and we will restore it (subject to
              the time windows below). Repeat infringers lose access to
              Taxottic.
            </p>
            <p>
              This page is the formal version of that promise, written to
              meet the requirements of the Digital Millennium Copyright
              Act (17 U.S.C. § 512). Nothing here is legal advice.
            </p>
          </Section>

          <Section title="Where to send notices">
            <p>
              Taxottic&apos;s designated agent under 17 U.S.C. § 512(c)(2)
              is:
            </p>
            <p className="bg-cream/70 border border-forest-100 rounded-lg p-4 grid gap-1">
              <span>
                <strong>Designated DMCA Agent</strong>
              </span>
              <span>Techno Optics LLC</span>
              <span>Attn: DMCA Agent</span>
              <span>
                Email:{" "}
                <a
                  href="mailto:dmca@taxottic.com"
                  className="underline hover:text-forest-900"
                >
                  dmca@taxottic.com
                </a>
              </span>
              <span>
                Postal mail address available on request to the email
                above. We will also register this agent with the U.S.
                Copyright Office DMCA Designated Agent Directory.
              </span>
            </p>
            <p>
              Email is the fastest channel. We acknowledge DMCA notices
              within two business days.
            </p>
          </Section>

          <Section title="What a valid notice must include">
            <p>To be effective under § 512(c)(3)(A), your notice must:</p>
            <ol className="list-decimal pl-5 grid gap-2">
              <li>
                Identify the copyrighted work you claim has been
                infringed (a title, a URL, or a description sufficient
                for us to find it).
              </li>
              <li>
                Identify the allegedly infringing material on Taxottic
                with enough detail for us to locate it — typically a URL,
                a file name, the company / matter it lives under, or a
                screenshot.
              </li>
              <li>Your name, address, phone, and email.</li>
              <li>
                The statement: <em>&ldquo;I have a good faith belief that
                use of the material in the manner complained of is not
                authorized by the copyright owner, its agent, or the
                law.&rdquo;</em>
              </li>
              <li>
                The statement, under penalty of perjury: <em>&ldquo;The
                information in this notification is accurate, and I am
                the owner, or authorized to act on behalf of the owner,
                of an exclusive right that is allegedly infringed.&rdquo;</em>
              </li>
              <li>Your physical or electronic signature.</li>
            </ol>
            <p>
              Notices missing any of these elements may be returned for
              correction. Knowingly material misrepresentations carry
              liability under § 512(f).
            </p>
          </Section>

          <Section title="Counter-notices">
            <p>
              If your content was removed and you believe the removal
              was a mistake or misidentification, you can send us a
              counter-notice under § 512(g)(3). It must include:
            </p>
            <ol className="list-decimal pl-5 grid gap-2">
              <li>Identification of the removed material and where it appeared.</li>
              <li>
                The statement, under penalty of perjury: <em>&ldquo;I have
                a good faith belief that the material was removed or
                disabled as a result of mistake or misidentification.&rdquo;</em>
              </li>
              <li>
                Your name, address, phone, email, and a statement that you
                consent to the jurisdiction of the U.S. District Court for
                the federal judicial district where you live (or, if you
                live outside the U.S., the U.S. District Court for the
                Southern District of New York), and that you will accept
                service of process from the complainant.
              </li>
              <li>Your physical or electronic signature.</li>
            </ol>
            <p>
              We will forward valid counter-notices to the complainant.
              If the complainant does not file suit within 10–14 business
              days, we will restore the content.
            </p>
          </Section>

          <Section title="Repeat infringer policy">
            <p>
              In line with § 512(i), we terminate the accounts of users
              who, in our judgment, are repeat infringers. The threshold
              is intentionally not a fixed strike count — we look at the
              pattern of notices, the user&apos;s response, and whether the
              activity appears willful.
            </p>
            <p>
              Termination ends access to the workspace, including any
              client companies the user managed. Customers should keep
              independent copies of records they need to retain.
            </p>
          </Section>

          <Section title="What this policy does NOT cover">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                Trademark complaints — please contact{" "}
                <a
                  href="mailto:legal@taxottic.com"
                  className="underline hover:text-forest-900"
                >
                  legal@taxottic.com
                </a>{" "}
                instead.
              </li>
              <li>
                Privacy / personal-data complaints — see the{" "}
                <Link href="/legal/privacy" className="underline hover:text-forest-900">
                  Privacy Policy
                </Link>{" "}
                for how to request access, correction, or deletion.
              </li>
              <li>
                General content complaints (e.g., abuse, harassment) —
                see the{" "}
                <Link
                  href="/legal/acceptable-use"
                  className="underline hover:text-forest-900"
                >
                  Acceptable Use Policy
                </Link>
                .
              </li>
            </ul>
          </Section>
        </div>
      </section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="display text-xl text-forest-900">{title}</h2>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}
