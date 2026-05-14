import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { BellaChat } from "@/components/BellaChat";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";

// Tier 3 #1: Bella on the firm side.
//
// Bella has lived on the consumer surface forever; firm preparers
// asked for the same assistant scoped to their cockpit so they
// can ask "what changed in §174 R&D capitalization for tax year
// 2026" without flipping out of their workflow. We reuse the same
// BellaChat component + API route — the auth check on /api/bella
// is just "is the user logged in," so this page works as-is. The
// firm chrome around it sets context.

export const metadata = {
  title: "Bella — Firm cockpit",
  description:
    "Ask Bella about tax code, deductions, and engagement issues from inside the firm cockpit.",
  robots: { index: false, follow: false },
};

export default async function FirmBellaPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const { company: companyPublicId } = await searchParams;

  return (
    <main id="main" className="min-h-screen flex flex-col">
      <AppHeader email={user.email ?? undefined} />

      <section className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Bella
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Ask Bella anything.
        </h1>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-xl">
          Bella is your in-cockpit research partner. Ask about IRS
          publications, deductions, entity changes, multi-state
          allocations — she cites her sources when the knowledge
          base applies. Your firm tier ({ctx.firm.tier}) controls
          which Bella model you reach.
        </p>

        <BellaChat companyPublicId={companyPublicId} />

        <p className="mt-6 text-[11px] leading-relaxed text-ink-muted">
          Bella provides educational guidance, not legal or tax
          advice. Verify code citations against the underlying IRS
          publication before relying on them with a client.
        </p>
      </section>
    </main>
  );
}
