import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { TeamChat, type ChatMember, type ChatMessage } from "@/components/TeamChat";
import { sendTeamMessage, deleteTeamMessage } from "./actions";

type Params = Promise<{ publicId: string }>;

export default async function ChatPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company, isManager } =
    await loadCompanyByPublicId(publicId);

  // Fetch the most recent 200 messages in chronological order. The
  // realtime channel will keep the list live from here on.
  const [{ data: messages }, { data: members }] = await Promise.all([
    supabase
      .from("team_messages")
      .select("id, user_id, body, created_at")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("company_members")
      .select(
        "user_id, profile:profiles(full_name, email)",
      )
      .eq("company_id", company.id),
  ]);

  // The query above is descending so newest messages come back first;
  // reverse to chronological for display.
  const initialMessages: ChatMessage[] = ((messages ?? []) as ChatMessage[])
    .slice()
    .reverse();

  // The supabase-js types model the joined `profile:profiles(...)` as
  // an array even when the FK is to-one, so we cast through unknown.
  const memberList: ChatMember[] = (
    (members ?? []) as unknown as Array<{
      user_id: string;
      profile:
        | { full_name: string | null; email: string | null }
        | { full_name: string | null; email: string | null }[]
        | null;
    }>
  ).map((m) => {
    const profile = Array.isArray(m.profile) ? m.profile[0] : m.profile;
    return {
      user_id: m.user_id,
      full_name: profile?.full_name ?? null,
      email: profile?.email ?? null,
    };
  });

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-500">·</span> Team chat
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

        <div className="mt-6">
          <TeamChat
            companyId={company.id}
            companyName={company.name}
            currentUserId={user.id}
            initialMessages={initialMessages}
            members={memberList}
            sendAction={sendTeamMessage}
            deleteAction={deleteTeamMessage}
            isManager={isManager}
          />
        </div>
      </section>
    </main>
  );
}
