import { PageShell } from "@/components/marketing/PageShell";
import { BookForm } from "./BookForm";

type Sp = Promise<{ for?: string; from?: string }>;

// Public booking / migration intake. No sign-in required so a firm
// partner can fill the form on their phone in 30 seconds.
//
// Query params:
//   ?for=firm | individual | small_business  - pre-select audience
//   ?from=...                                  - source attribution
export default async function BookPage({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const audience: "firm" | "individual" | "small_business" =
    sp.for === "individual"
      ? "individual"
      : sp.for === "small_business"
        ? "small_business"
        : "firm";

  return (
    <main data-grammar="year" className="min-h-screen bg-[var(--color-cream)]">
      <PageShell>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <p className="mono-label">
          {audience === "firm"
            ? "For tax-prep firms"
            : audience === "small_business"
              ? "For small businesses"
              : "Quick chat"}
        </p>
        <h1 className="display mt-3 text-4xl sm:text-6xl text-forest-900 leading-tight">
          {audience === "firm"
            ? "Tell us a little about your firm."
            : audience === "small_business"
              ? "We would love to learn about your business."
              : "Happy to chat. No pressure."}
        </h1>
        <p className="mt-4 text-base sm:text-lg text-ink-soft max-w-2xl leading-relaxed">
          {audience === "firm"
            ? "Share a few details and we will reach out with a 15-minute walkthrough plus a migration plan tailored to your client list. No account needed; you can keep using your current tools while we set things up."
            : "A few quick fields and we will follow up with the next step. Nothing is locked in; we want to make sure Taxottic is the right fit before either of us spends time on a sign-up."}
        </p>

        <div className="mt-8 sm:mt-10 card p-6 sm:p-8">
          <BookForm initialAudience={audience} />
        </div>

        <ul className="mt-8 grid sm:grid-cols-3 gap-5">
          <Reassurance
            label="No sign-in"
            body="The form is the form. You will not get bounced to a sign-up screen."
          />
          <Reassurance
            label="No spam"
            body="One reply from a real person, not a drip campaign."
          />
          <Reassurance
            label="Your data, your call"
            body="Nothing is shared. Drop us a note any time to delete your details."
          />
        </ul>

        <p className="mt-8 text-xs text-ink-muted">
          Prefer email? Write to{" "}
          <a
            href="mailto:hello@taxottic.com"
            className="underline hover:text-forest-700"
          >
            hello@taxottic.com
          </a>{" "}
          and we will pick it up from there.
        </p>
      </section>
      </PageShell>
    </main>
  );
}

function Reassurance({ label, body }: { label: string; body: string }) {
  return (
    <li>
      <span className="mono-label">{label}</span>
      <p className="mt-1.5 text-xs text-ink-soft leading-relaxed">{body}</p>
    </li>
  );
}
