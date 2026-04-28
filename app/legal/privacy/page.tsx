export const metadata = { title: "Privacy - Taxottic" };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen">
      <section className="max-w-2xl mx-auto px-6 py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Privacy
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Your data, in plain English.
        </h1>

        <div className="mt-6 prose-sm text-sm text-ink-soft leading-relaxed grid gap-4">
          <p>
            Taxottic is built by Techno Optics LLC. We collect only the data
            needed to forecast your taxes and operate your account: your
            email and name (from sign-in), your tax profile (filing status,
            state, dependents), the income and expense entries you log, and
            messages you send Bella.
          </p>
          <p>
            <strong>Storage.</strong> Data is stored on Supabase (US region,
            encrypted at rest and in transit) and served via Vercel.
          </p>
          <p>
            <strong>Sharing.</strong> We do not sell your data and we do not
            share it with marketers. Anthropic processes your messages to
            Bella to generate replies. Stripe processes subscription
            payments if you choose Pro.
          </p>
          <p>
            <strong>Your rights.</strong> You can export your data, correct
            it, or delete your account at any time. Email{" "}
            <a
              href="mailto:contact@taxottic.com"
              className="underline hover:text-forest-900"
            >
              contact@taxottic.com
            </a>{" "}
            and we will action it within 30 days.
          </p>
          <p>
            <strong>Cookies.</strong> Only what is necessary for sign-in and
            session continuity. No advertising cookies.
          </p>
          <p className="text-xs text-ink-muted">
            This summary supplements, but does not replace, our full Privacy
            Policy. Last updated 2026-04-28.
          </p>
        </div>
      </section>
    </main>
  );
}
