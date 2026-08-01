import { AppHeader } from "@/components/AppHeader";
import { ProGate } from "@/components/ProGate";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { getCompanyFeatureGates } from "@/lib/plans/usage";
import { createServiceClient } from "@/lib/supabase/server";
import { ChatInbox } from "@/components/chat/ChatInbox";
import { buildInbox, type InboxMessage } from "@/lib/chat/inbox";
import { createGroup, createOrOpenDm } from "./actions";

type Params = Promise<{ publicId: string }>;

// Recent-message window used to build the list previews. A company
// noisier than this simply shows no preview on its quietest
// conversations; it never shows the wrong one, because the newest
// message per conversation is picked from whatever this returns.
const PREVIEW_MESSAGE_WINDOW = 500;

/**
 * Chat landing: the conversation inbox.
 *
 * This route used to `redirect()` into the company's default General
 * channel, which made chat feel like one company-wide room with no way
 * to reach a person. General still exists and still holds its history;
 * it is now one row in this list instead of the only destination.
 */
export default async function ChatInboxPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

  // Company-plan feature (audit major #25): team chat belongs to the
  // COMPANY's subscription, so an employee's lapsed personal trial
  // must not lock them out of the workspace their employer pays for.
  const { gates } = await getCompanyFeatureGates(company.id);
  if (!gates.teamChat) {
    return (
      <Shell publicId={publicId} email={user.email} companyName={company.name}>
        <div className="mt-6">
          <ProGate
            feature="Team chat"
            pitch="Direct messages, private groups, and open channels with file attachments - the in-app workspace for everyone you work with on this company. A conversation stays readable only by the people in it, and the data stays in your Taxottic rather than in some third-party Slack."
            perks={[
              "One to one direct messages",
              "Named private groups for a few of you",
              "File and image attachments up to 25 MB each",
              "Realtime delivery, no refresh needed",
            ]}
            reason="team_chat"
          />
        </div>
      </Shell>
    );
  }

  // RLS decides what is visible: every channel of this company, plus
  // the groups and DMs this user is an explicit member of. Nothing
  // below re-filters, because the database already did.
  const [
    { data: conversations },
    { data: companyMembers },
    { data: recentMessages },
    { data: reads },
  ] = await Promise.all([
    supabase
      .from("chat_conversations")
      .select(
        "id, kind, name, is_default, created_at, members:chat_conversation_members(user_id)",
      )
      .eq("company_id", company.id),
    supabase
      .from("company_members")
      .select("user_id, role")
      .eq("company_id", company.id),
    supabase
      .from("team_messages")
      .select(
        "conversation_id, user_id, body, created_at, attachments:chat_attachments(id)",
      )
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(PREVIEW_MESSAGE_WINDOW),
    supabase
      .from("chat_conversation_reads")
      .select("conversation_id, last_read_at")
      .eq("user_id", user.id),
  ]);

  // company_members.user_id has no foreign key to profiles (it points
  // at auth.users), so PostgREST cannot embed the profile and the whole
  // query comes back null - this was the "chat shows 0 members" bug.
  // Fetch profiles separately and stitch by id, exactly like the
  // conversation page and the manage page do.
  const admin = createServiceClient();
  const memberIds = ((companyMembers ?? []) as { user_id: string }[]).map(
    (m) => m.user_id,
  );
  const { data: memberProfiles } = memberIds.length
    ? await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", memberIds)
    : {
        data: [] as {
          id: string;
          full_name: string | null;
          email: string | null;
        }[],
      };
  const profileById = new Map((memberProfiles ?? []).map((p) => [p.id, p]));

  const members = (
    (companyMembers ?? []) as { user_id: string; role: string }[]
  ).map((m) => {
    const p = profileById.get(m.user_id) ?? null;
    return {
      user_id: m.user_id,
      role: m.role,
      full_name: p?.full_name ?? null,
      email: p?.email ?? null,
    };
  });

  const conversationList = (
    (conversations ?? []) as Array<{
      id: string;
      kind: string;
      name: string | null;
      is_default: boolean;
      created_at: string;
      members: { user_id: string }[];
    }>
  ).map((c) => ({
    id: c.id,
    kind: c.kind as "channel" | "group" | "dm",
    name: c.name,
    is_default: c.is_default,
    created_at: c.created_at,
    member_ids: c.members.map((m) => m.user_id),
  }));

  const messages: InboxMessage[] = (
    (recentMessages ?? []) as Array<{
      conversation_id: string;
      user_id: string;
      body: string;
      created_at: string;
      attachments: { id: string }[] | null;
    }>
  ).map((m) => ({
    conversation_id: m.conversation_id,
    user_id: m.user_id,
    body: m.body,
    created_at: m.created_at,
    has_attachment: (m.attachments ?? []).length > 0,
  }));

  const readAt = new Map(
    (
      (reads ?? []) as Array<{
        conversation_id: string;
        last_read_at: string;
      }>
    ).map((r) => [r.conversation_id, r.last_read_at] as const),
  );

  const rows = buildInbox({
    conversations: conversationList,
    messages,
    members,
    currentUserId: user.id,
    readAt,
  });

  return (
    <Shell publicId={publicId} email={user.email} companyName={company.name}>
      <div className="mt-6">
        <ChatInbox
          companyId={company.id}
          companyPublicId={publicId}
          currentUserId={user.id}
          rows={rows}
          companyMembers={members}
          createGroupAction={createGroup}
          createDmAction={createOrOpenDm}
        />
      </div>
    </Shell>
  );
}

function Shell({
  publicId,
  email,
  companyName,
  children,
}: {
  publicId: string;
  email: string | null | undefined;
  companyName: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-3 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-6 sm:py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          Chat
        </div>
        <h1 className="display mt-2 text-2xl sm:text-3xl text-forest-900">
          {companyName}
        </h1>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>
        {children}
      </section>
    </main>
  );
}
