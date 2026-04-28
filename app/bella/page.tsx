import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { BellaChat } from "@/components/BellaChat";

export default async function BellaPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { supabase, user } = await requireUser();
  const { company: companyPublicId } = await searchParams;

  let companyName: string | null = null;
  if (companyPublicId) {
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("public_id", companyPublicId)
      .maybeSingle();
    companyName = company?.name ?? null;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Bella requires the env var. Don't redirect; render a graceful page.
  }

  return (
    <main className="min-h-screen flex flex-col">
      <AppHeader email={user.email ?? undefined} />
      <section className="flex-1 max-w-3xl w-full mx-auto px-6 py-8 flex flex-col">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Bella - your tax guide
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          {companyName ? `Ask Bella about ${companyName}` : "Ask Bella"}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Ask anything about deductions, tax math, entity types, or what you
          owe. Bella cites sources from the knowledge base when they apply.
        </p>

        <BellaChat companyPublicId={companyPublicId} />

        <p className="mt-6 text-[11px] leading-relaxed text-ink-muted">
          Bella provides educational guidance, not legal or tax advice. Always
          verify important decisions with a licensed CPA.
        </p>
      </section>
    </main>
  );
}
