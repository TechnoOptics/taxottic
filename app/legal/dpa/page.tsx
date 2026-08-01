import Link from "next/link";

/**
 * UNREVIEWED DRAFT. Not legal advice, not a final legal instrument.
 *
 * Revised 2026-08-01. This DPA previously did not mention geolocation
 * anywhere, even though enabling mileage tracking is the single most
 * consequential thing a business Customer can do on Taxottic and the
 * one most likely to attract a regulator. Added to section 2
 * (categories) and section 4 (roles / who carries the employee
 * monitoring obligations).
 *
 * ATTORNEY: this whole document is a template that has never been
 * reviewed. The clauses most in need of your attention are section 4
 * (the controller/processor allocation for employee location
 * monitoring), section 7 (international transfers, which currently
 * asserts SCC reliance without the SCCs being attached), and section 9
 * (audit rights). Version number left at 1.0 deliberately: bump it
 * when a reviewed version is issued.
 */

export const metadata = {
  title: "Data Processing Agreement - Taxottic",
  description:
    "The standard DPA for Taxottic firm and business customers, covering processing scope, subprocessors, transfers, and employee location monitoring.",
  alternates: { canonical: "/legal/dpa" },
};

export default function DpaPage() {
  return (
    <main id="main" className="min-h-screen">
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Data Processing Agreement
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          DPA for firm and business customers.
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          Effective: 2026-05-04 · Version 1.0
        </p>

        <div className="mt-8 text-sm text-ink-soft leading-relaxed grid gap-6">
          <p>
            This Data Processing Agreement (&quot;DPA&quot;) supplements the
            Taxottic{" "}
            <Link href="/legal/terms" className="underline hover:text-forest-900">
              Terms of Service
            </Link>{" "}
            and applies when Techno Optics LLC (&quot;Processor&quot;)
            processes Personal Data on behalf of a Customer
            (&quot;Controller&quot;) - typically a tax-preparation firm or
            a business with multiple users.
          </p>

          <Section title="1. Subject matter and duration">
            <p>
              The Processor processes Personal Data to provide the
              Taxottic service to the Controller and its end users
              (clients, employees) as described in the Terms. The DPA
              remains in effect for the term of the Customer&apos;s
              subscription plus the deletion period in Section 8.
            </p>
          </Section>

          <Section title="2. Nature and purpose of processing">
            <p>
              Hosting, storing, retrieving, transmitting, and computing
              tax forecasts on Personal Data the Customer or its end
              users submit, including: name, email, tax profile,
              business profile, income / expense entries, bank
              transaction metadata, uploaded and scanned documents,
              taxpayer identification numbers, in-app messages, device
              and diagnostic data, and conversations with Bella.
            </p>
            <p>
              <strong>Geolocation data.</strong> Where the Customer
              enables automatic mileage tracking, processing also
              includes precise location data captured from a data
              subject&apos;s mobile device, including background capture,
              and the trips derived from it. What is captured, the
              retention periods, and the visibility given to the
              Customer&apos;s managers and to any engaged firm are set out
              at{" "}
              <Link
                href="/legal/location-monitoring"
                className="underline hover:text-forest-900"
              >
                /legal/location-monitoring
              </Link>
              , which forms part of this Agreement.
            </p>
          </Section>

          <Section title="3. Data subjects">
            <ul className="list-disc pl-5 grid gap-2">
              <li>The Customer&apos;s authorised users (employees, partners).</li>
              <li>The Customer&apos;s end clients (when the Customer is a tax-prep firm).</li>
            </ul>
          </Section>

          <Section title="4. Roles">
            <p>
              The Customer is the Controller. Techno Optics LLC is the
              Processor. Where required by law, both parties shall comply
              with their respective obligations under GDPR (EU 2016/679),
              UK GDPR, and CCPA / CPRA.
            </p>
            <p>
              <strong>Employee monitoring.</strong> If the Customer
              enables automatic mileage tracking for its workers, the
              Customer determines the purposes and means of that
              monitoring and is the Controller of the resulting location
              data. The Customer is responsible for providing whatever
              notice is required in each jurisdiction where its workers
              are located, for obtaining any consent or authorisation
              required there, for establishing a lawful basis, and for
              carrying out any data protection impact assessment that
              applies. Taxottic supplies the product controls and the
              notice referenced in section 2 and does not advise the
              Customer on the lawfulness of its monitoring.
            </p>
          </Section>

          <Section title="5. Processor obligations">
            <ul className="list-disc pl-5 grid gap-2">
              <li>Process Personal Data only on documented Controller instructions (the Terms + this DPA + in-product configuration).</li>
              <li>Ensure persons authorised to process the data are bound by confidentiality.</li>
              <li>Implement the security measures listed in our{" "}
                <Link href="/legal/security" className="underline hover:text-forest-900">
                  Security overview
                </Link>
                .</li>
              <li>Notify the Controller without undue delay (and within 72 hours) of becoming aware of a Personal Data breach.</li>
              <li>Assist the Controller in responding to data-subject requests and in conducting Data Protection Impact Assessments.</li>
              <li>Make available the information needed to demonstrate compliance.</li>
              <li>Delete or return Personal Data after the end of the service per Section 8.</li>
            </ul>
          </Section>

          <Section title="6. Subprocessors">
            <p>
              The Controller authorises the use of the subprocessors
              listed at{" "}
              <Link href="/legal/subprocessors" className="underline hover:text-forest-900">
                /legal/subprocessors
              </Link>
              . The Processor will give 30 days&apos; notice (in-app
              banner + that page) before adding or replacing a
              subprocessor; the Controller may terminate the
              subscription if it reasonably objects.
            </p>
          </Section>

          <Section title="7. International transfers">
            <p>
              Personal Data is hosted in the United States. For
              transfers from the EEA, UK, or Switzerland, the parties
              rely on the Standard Contractual Clauses (Module 2:
              controller to processor) issued by the European
              Commission, incorporated by reference. The UK Addendum
              applies to UK transfers; the Swiss FDPIC&apos;s amendments
              apply to Swiss transfers.
            </p>
          </Section>

          <Section title="8. Deletion / return">
            <p>
              On termination, the Processor will delete all Personal
              Data within 30 days from production systems and within 90
              days from encrypted backups, unless retention is required
              by law. The Controller may export its data via the
              official year-end export at any time before termination.
            </p>
          </Section>

          <Section title="9. Audit">
            <p>
              The Processor will provide its most recent SOC 2 report
              (under NDA) on request, no more than once per year except
              when required by law or following a security incident. On-
              site audits may be arranged with reasonable notice and at
              the Controller&apos;s expense, scoped to the Personal Data
              processed under this DPA.
            </p>
          </Section>

          <Section title="10. Contact">
            <p>
              To execute a counter-signed DPA on letterhead, write to{" "}
              <a href="mailto:privacy@taxottic.com" className="underline hover:text-forest-900">
                privacy@taxottic.com
              </a>
              . By using Taxottic with multi-user / firm features, you
              accept the terms above.
            </p>
          </Section>
        </div>
      </section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="display text-xl text-forest-900">{title}</h2>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}
