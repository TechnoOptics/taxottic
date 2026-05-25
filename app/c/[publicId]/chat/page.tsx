import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { ProGate } from "@/components/ProGate";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { getActiveFeatureGates } from "@/lib/plans/usage";

type Params = Promise<{ publicId: string }>;

/**
 * Top-level chat route just bounces into the company's default
 * "General" channel. Every company has one (auto-seeded by trigger),
 * so this should always have a target.
 */
export default async function ChatLandingPage({
  params,
}: {
  params: Params;
}) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

  // Pro-only feature.
  const { gates } = await getActiveFeatureGates(supabase, user.id);
  if (!gates.teamChat) {
    return (
      <main id="main" className="min-h-screen">
        <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
        <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
            {company.public_id} <span className="text-gold-700">·</span> Chat
          </div>
          <h1 className="display mt-2 text-3xl text-forest-900">
            {company.name}
          </h1>
          <div aria-hidden="true" className="gold-flourish mt-3">
            <span />
          </div>
          <div className="mt-6">
            <CompanyNav publicId={publicId} active="chat" />
          </div>
          <ProGate
            feature="Team chat"
            pitch="Channels, private groups, and 1:1 DMs with file attachments - the in-app workspace for everyone you work with on this company. Read access stays scoped to your team; the data stays in your Taxottic, not in some third-party Slack."
            perks={[
              "Channels (everyone) + named private groups + DMs",
              "File + image attachments up to 25 MB each",
              "Realtime delivery, no refresh needed",
              "Plus everything in Pro: Bella AI, bank connections, find-a-CPA",
            ]}
            reason="team_chat"
          />
        </section>
      </main>
    );
  }

  const { data: defaultChannel } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("company_id", company.id)
    .eq("is_default", true)
    .maybeSingle();

  if (defaultChannel) {
    redirect(`/c/${publicId}/chat/${defaultChannel.id}`);
  }

  // Extremely rare fallback: trigger somehow didn't fire. Pick any
  // channel the user can see; if none, just bounce to forecast.
  const { data: any } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("company_id", company.id)
    .eq("kind", "channel")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (any) redirect(`/c/${publicId}/chat/${any.id}`);
  redirect(`/c/${publicId}/forecast`);
}
