import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
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
    <main className="min-h-screen bg-[var(--color-cream)]">
      {/* Calm forest header so the page feels of a piece with the rest
          of the site, but lighter than the marketing hero. */}
      <header
        className="relative"
        style={{
          background:
            "var(--navy-band)",
          borderBottom: "1px solid rgba(213, 187, 126, 0.14)",
          // Native iOS overlays the WebView under the status bar, pad by
          // the real safe-area inset so the wordmark clears the notch /
          // Dynamic Island (matches app/page.tsx + AppHeader). 0 on web.
          paddingTop:
            "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {/* gap + shrink-0: at 375px the wordmark left the link ~78px and
            "Back to home" wrapped to two lines beside it. The Wordmark is
            min-w-0 with a max-w-full image, so it is the one that yields. */}
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between gap-4">
          <Wordmark size="md" tone="cream" />
          <Link
            href="/"
            className="shrink-0 whitespace-nowrap text-sm text-cream/80 hover:text-cream transition-colors"
          >
            Back to home
          </Link>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-xs uppercase tracking-[0.22em] text-gold-700">
          {audience === "firm"
            ? "For tax-prep firms"
            : audience === "small_business"
              ? "For small businesses"
              : "Quick chat"}
        </div>
        <h1 className="display mt-3 text-3xl sm:text-5xl text-forest-900 leading-tight">
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

        <div className="mt-8 grid sm:grid-cols-3 gap-3">
          <Reassurance
            kicker="No sign-in"
            body="The form is the form. You will not get bounced to a sign-up screen."
          />
          <Reassurance
            kicker="No spam"
            body="One reply from a real person, not a drip campaign."
          />
          <Reassurance
            kicker="Your data, your call"
            body="Nothing is shared. Drop us a note any time to delete your details."
          />
        </div>

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
    </main>
  );
}

function Reassurance({ kicker, body }: { kicker: string; body: string }) {
  return (
    <div className="rounded-xl border border-forest-100 bg-white/70 p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
        {kicker}
      </div>
      <p className="mt-2 text-xs text-ink-soft leading-relaxed">{body}</p>
    </div>
  );
}
