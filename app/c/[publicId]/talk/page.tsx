import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";

type Params = Promise<{ publicId: string }>;

/**
 * Talk hub. The two conversation surfaces - internal team chat
 * and external tax preparer engagement - sit side by side here so
 * the user can see "who do I need to message" in one glance. Both
 * are infrequent destinations on their own; merging them under
 * one tab buys the user back a slot in the main 5-tab strip.
 */
export default async function TalkHub({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

  const [chatResp, engagementResp] = await Promise.all([
    supabase
      .from("chat_conversations")
      .select("id, last_message_at")
      .eq("company_id", company.id)
      .order("last_message_at", { ascending: false })
      .limit(5),
    supabase
      .from("firm_engagements")
      .select("id, firm_name, status, created_at")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false }),
  ]);

  const conversationCount = (chatResp.data ?? []).length;
  const lastMessageAt = chatResp.data?.[0]?.last_message_at ?? null;
  const lastMessageAgo = lastMessageAt ? humanAgo(lastMessageAt) : null;

  const engagements = engagementResp.data ?? [];
  const activeEngagement = engagements.find(
    (e) => e.status === "active" || e.status === "accepted",
  );
  const pendingEngagement = engagements.find(
    (e) => e.status === "pending" || e.status === "invited",
  );

  const sections: SectionCardProps[] = [
    {
      title: "Team chat",
      subtitle: "Quick messages with co-owners + employees on this company.",
      stat:
        conversationCount === 0
          ? "No conversations yet."
          : lastMessageAgo
            ? `${conversationCount} ${
                conversationCount === 1 ? "conversation" : "conversations"
              }. Last message ${lastMessageAgo}.`
            : `${conversationCount} ${
                conversationCount === 1 ? "conversation" : "conversations"
              }.`,
      primary: {
        label: conversationCount === 0 ? "Start a chat" : "Open chat",
        href: `/c/${publicId}/chat`,
      },
      secondaryHref: `/c/${publicId}/chat`,
    },
    {
      title: "Tax preparer",
      subtitle:
        "Engage a Taxottic-verified firm to handle your filing end of year.",
      stat: activeEngagement
        ? `Engaged with ${activeEngagement.firm_name}.`
        : pendingEngagement
          ? `Invitation pending from ${pendingEngagement.firm_name}.`
          : "No preparer engaged yet.",
      primary: {
        label: activeEngagement ? "Open preparer" : "Find a preparer",
        href: `/c/${publicId}/preparer`,
      },
      secondaryHref: `/c/${publicId}/preparer`,
      attention: Boolean(pendingEngagement),
    },
  ];

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Talk</h1>
        <p className="mt-2 text-sm text-ink-soft max-w-xl">
          People who help with this company. Your team for day-to-day
          coordination, your tax preparer for the heavy filing season.
        </p>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="talk" />
        </div>

        <div className="mt-6 space-y-4">
          {sections.map((s) => (
            <SectionCard key={s.title} {...s} />
          ))}
        </div>
      </section>
    </main>
  );
}

/** Compact "5m ago" / "3h ago" / "2d ago" string. */
function humanAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

type SectionCardProps = {
  title: string;
  subtitle: string;
  stat: string;
  primary: { label: string; href: string };
  secondaryHref: string;
  attention?: boolean;
};

function SectionCard(s: SectionCardProps) {
  return (
    <div
      className={`card p-5 ${
        s.attention ? "ring-1 ring-gold-400/70 bg-gold-50/30" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-baseline gap-2">
          {s.attention ? (
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-gold-600 mt-2"
            />
          ) : null}
          <div>
            <h3 className="display text-lg text-forest-900">{s.title}</h3>
            <p className="text-[12.5px] text-ink-soft mt-0.5">{s.subtitle}</p>
          </div>
        </div>
        <Link
          href={s.secondaryHref}
          className="text-[12.5px] text-gold-700 hover:text-gold-800 font-medium whitespace-nowrap"
        >
          Open →
        </Link>
      </div>
      <p className="mt-3 text-[14px] text-forest-900">{s.stat}</p>
      <div className="mt-4">
        <Link
          href={s.primary.href}
          className="inline-flex items-center justify-center px-4 h-10 rounded-md bg-forest-900 text-cream text-sm font-medium hover:bg-forest-800 transition-colors"
        >
          {s.primary.label}
        </Link>
      </div>
    </div>
  );
}
