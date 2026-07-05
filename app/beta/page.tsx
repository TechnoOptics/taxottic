import { AppHeader } from "@/components/AppHeader";
import { requireUser } from "@/lib/auth";
import { BetaChecklist } from "@/components/BetaChecklist";
import { submitFeedback } from "@/app/actions/feedback";

export const dynamic = "force-dynamic";

/**
 * Beta tester landing page: a checklist of the flows we most want exercised,
 * plus a one-tap path into the existing feedback modal. Linked from the beta
 * invite email's follow-up and shareable with any tester at /beta.
 */
export default async function BetaPage() {
  const { user } = await requireUser();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          Taxottic beta
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          Thanks for testing
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-xl leading-relaxed">
          Here are the flows we&rsquo;d love you to try. Work through what
          applies to you, and send a note whenever something feels off, breaks,
          or delights. Every item lists what to watch for.
        </p>

        <BetaChecklist submitAction={submitFeedback} />
      </section>
    </main>
  );
}
