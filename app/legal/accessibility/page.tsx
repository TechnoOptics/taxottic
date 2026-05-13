import Link from "next/link";

export const metadata = {
  title: "Accessibility — Taxottic WCAG 2.2 AA commitment",
  description:
    "Taxottic's accessibility commitment. WCAG 2.2 Level AA target, what's in place today, known gaps, and how to report a barrier (access@taxottic.com).",
  alternates: { canonical: "/legal/accessibility" },
  openGraph: {
    title: "Taxottic Accessibility",
    description:
      "WCAG 2.2 AA commitment, keyboard-only navigation, passkey sign-in, and how to report a barrier.",
    url: "/legal/accessibility",
    type: "article",
  },
};

// Accessibility commitment page expected by enterprise procurement and
// flagged P1 by the May 2026 audit. Documents the WCAG 2.2 AA conformance
// target, lists the features already in place, names the known gaps so
// we don't pretend the surface is finished, and gives users a real
// channel to report barriers. The list of "what's already in place" is
// fact-checked against the live product, not aspirational.
export default function AccessibilityPage() {
  return (
    <main className="min-h-screen">
      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Accessibility
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          We&apos;re building Taxottic so everyone can use it.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Effective: 2026-05-12 · Last updated: 2026-05-12 · Questions or
          barriers:{" "}
          <a
            href="mailto:access@taxottic.com"
            className="underline hover:text-forest-900"
          >
            access@taxottic.com
          </a>
        </p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <Section title="Our commitment">
            <p>
              Taxes are stressful enough; using a tax product should not
              add a second barrier. Taxottic is designed to meet the{" "}
              <a
                href="https://www.w3.org/TR/WCAG22/"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-forest-900"
              >
                Web Content Accessibility Guidelines 2.2, Level AA
              </a>
              , and we treat accessibility as a release gate, not a
              backlog item.
            </p>
            <p>
              We are not yet fully conformant. The honest gaps are listed
              below.
            </p>
          </Section>

          <Section title="What's in place today">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <strong>Keyboard-only navigation.</strong> Every primary
                flow (sign in, add a company, log an expense, view the
                forecast, sign out) is operable without a mouse, with
                visible focus indicators.
              </li>
              <li>
                <strong>Screen-reader-friendly structure.</strong>{" "}
                Landmarks (<code>header</code>, <code>main</code>,{" "}
                <code>nav</code>), heading hierarchy without skipped
                levels, descriptive button labels, and{" "}
                <code>aria-live=&quot;polite&quot;</code> announcements
                for status changes.
              </li>
              <li>
                <strong>Resizable text.</strong> Pinch-zoom and browser
                zoom are not capped — you can zoom up to 500% without
                losing content or function (WCAG 1.4.4). The previous
                viewport setting that capped zoom at 5× has been removed
                following the May 2026 audit.
              </li>
              <li>
                <strong>Colour contrast.</strong> Body text on cream and
                forest-green backgrounds meets AA contrast (4.5:1 for
                body, 3:1 for large text). The gold accent is decorative
                only — never relied on to convey state.
              </li>
              <li>
                <strong>Forms.</strong> Visible labels paired with
                inputs, descriptive error messages bound by{" "}
                <code>aria-describedby</code>, and required fields
                announced — not just shown with a red asterisk.
              </li>
              <li>
                <strong>Time-out warnings.</strong> Long-running flows
                that auto-save show a status pill so screen-reader users
                aren&apos;t surprised by silent state changes.
              </li>
              <li>
                <strong>Passkey sign-in.</strong> Biometric / device-PIN
                auth as an alternative to typing a password.
              </li>
              <li>
                <strong>No motion ambushes.</strong> Animations are short
                and decorative; users with{" "}
                <code>prefers-reduced-motion</code> see static
                alternatives where motion would otherwise convey
                meaning.
              </li>
            </ul>
          </Section>

          <Section title="Known gaps">
            <p>
              We&apos;d rather name what isn&apos;t there yet than claim a
              standard we haven&apos;t met:
            </p>
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                The forecast tile set has been visually re-tuned this
                quarter; a second screen-reader pass is scheduled for
                early Q3 2026.
              </li>
              <li>
                Bella&apos;s streaming chat output does not yet expose
                completed messages as discrete announcements. We&apos;re
                planning to switch to a per-message <code>aria-live</code>{" "}
                region.
              </li>
              <li>
                PDF reports produced by the forecast are
                machine-readable but the tagged-PDF structure has not
                been audited end-to-end. Until that work lands, accessible
                report exports are available on request to{" "}
                <a
                  href="mailto:access@taxottic.com"
                  className="underline hover:text-forest-900"
                >
                  access@taxottic.com
                </a>
                .
              </li>
              <li>
                The mobile native apps (iOS / Android) are behind the web
                app on screen-reader testing. We will not promote the
                mobile apps to general availability until the iOS
                VoiceOver and Android TalkBack pass meets the same bar
                as the web.
              </li>
            </ul>
          </Section>

          <Section title="Standards we measure against">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <a
                  href="https://www.w3.org/TR/WCAG22/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-forest-900"
                >
                  WCAG 2.2, Level AA
                </a>{" "}
                — the primary target.
              </li>
              <li>
                <a
                  href="https://www.section508.gov/manage/laws-and-policies/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-forest-900"
                >
                  Section 508
                </a>{" "}
                — for U.S. federal-procurement compatibility (informational).
              </li>
              <li>
                <a
                  href="https://www.access-board.gov/aba/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-forest-900"
                >
                  EN 301 549
                </a>{" "}
                — for EU public-sector procurement (informational).
              </li>
            </ul>
            <p>
              We do not yet publish an{" "}
              <a
                href="https://www.itic.org/policy/accessibility/vpat"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-forest-900"
              >
                ACR / VPAT
              </a>
              ; if you need one for procurement, write to{" "}
              <a
                href="mailto:access@taxottic.com"
                className="underline hover:text-forest-900"
              >
                access@taxottic.com
              </a>{" "}
              and we&apos;ll prepare one against your timeline.
            </p>
          </Section>

          <Section title="Report a barrier">
            <p>
              If something on Taxottic isn&apos;t usable for you,
              please email{" "}
              <a
                href="mailto:access@taxottic.com"
                className="underline hover:text-forest-900"
              >
                access@taxottic.com
              </a>{" "}
              and tell us:
            </p>
            <ul className="list-disc pl-5 grid gap-2">
              <li>The page or feature.</li>
              <li>The device, browser, and assistive technology you use.</li>
              <li>What you expected, and what happened instead.</li>
            </ul>
            <p>
              We acknowledge accessibility reports within two business
              days and aim to ship a fix within 30 days for blocking
              issues. While a barrier exists, we will offer an
              alternative path to complete the task — by email, phone, or
              with a member of the team on a call.
            </p>
          </Section>

          <Section title="Related policies">
            <ul className="list-disc pl-5 grid gap-2">
              <li>
                <Link href="/legal/security" className="underline hover:text-forest-900">
                  Security
                </Link>
              </li>
              <li>
                <Link href="/legal/privacy" className="underline hover:text-forest-900">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/legal/terms" className="underline hover:text-forest-900">
                  Terms of Service
                </Link>
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
