import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { getCompanyFeatureGates } from "@/lib/plans/usage";
import { createServiceClient } from "@/lib/supabase/server";
import { ChatShell } from "@/components/chat/ChatShell";
import {
  addGroupMember,
  createGroup,
  createOrOpenDm,
  deleteMessage,
  leaveConversation,
  removeGroupMember,
  sendMessage,
} from "../actions";

type Params = Promise<{ publicId: string; conversationId: string }>;

export default async function ConversationPage({
  params,
}: {
  params: Params;
}) {
  const { publicId, conversationId } = await params;
  const { supabase, user, company, isManager } =
    await loadCompanyByPublicId(publicId);

  // Same company-plan gate as the chat landing (audit major #25): this
  // route used to have NO gate at all, so a direct URL bypassed the
  // paywall entirely. Redirect to the landing, which renders the upsell.
  const { gates } = await getCompanyFeatureGates(company.id);
  if (!gates.teamChat) redirect(`/c/${publicId}/chat`);

  // Conversation: read with the user's RLS so we get a clean 404 for
  // conversations the user can't access.
  const { data: conversation } = await supabase
    .from("chat_conversations")
    .select(
      "id, company_id, kind, name, is_default, created_by, created_at",
    )
    .eq("id", conversationId)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!conversation) {
    // Could be a stale link or a conversation the user lost access to.
    redirect(`/c/${publicId}/chat`);
  }

  // Sidebar conversations: every channel + every group/DM the user is
  // an explicit member of. RLS already filters so this is safe.
  const [{ data: conversations }, { data: companyMembers }, { data: messages }, { data: convMembers }] =
    await Promise.all([
      supabase
        .from("chat_conversations")
        .select(
          "id, kind, name, is_default, created_at, members:chat_conversation_members(user_id)",
        )
        .eq("company_id", company.id)
        .order("kind", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("company_members")
        .select("user_id, role")
        .eq("company_id", company.id),
      supabase
        .from("team_messages")
        .select(
          "id, user_id, body, created_at, attachments:chat_attachments(id, storage_path, file_name, mime_type, size_bytes)",
        )
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("chat_conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId),
    ]);

  if (!conversations) notFound();

  // Generate short-lived signed URLs for every attachment so the
  // private bucket stays private but messages still render <img> /
  // download links inline.
  const admin = createServiceClient();

  // company_members.user_id has NO foreign key to profiles (it points at
  // auth.users), so PostgREST can't embed `profile:profiles(...)` - the
  // whole query comes back null and the roster/count shows 0 (this was the
  // "chat shows 0 members / no employees" bug). Fetch profiles separately
  // and stitch by id, exactly like the expenses / manage pages do.
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
  const profileById = new Map(
    (memberProfiles ?? []).map((p) => [p.id, p]),
  );

  type RawAttachment = {
    id: string;
    storage_path: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
  };
  type RawMessage = {
    id: string;
    user_id: string;
    body: string;
    created_at: string;
    attachments: RawAttachment[] | null;
  };

  const allPaths = ((messages ?? []) as RawMessage[])
    .flatMap((m) => (m.attachments ?? []).map((a) => a.storage_path))
    .filter(Boolean);
  const signedUrlMap = new Map<string, string>();
  if (allPaths.length > 0) {
    const { data: signed } = await admin.storage
      .from("chat-attachments")
      .createSignedUrls(allPaths, 60 * 60); // 1 hour
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedUrlMap.set(s.path, s.signedUrl);
    }
  }

  const initialMessages = ((messages ?? []) as RawMessage[])
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id,
      user_id: m.user_id,
      body: m.body,
      created_at: m.created_at,
      attachments: (m.attachments ?? []).map((a) => ({
        id: a.id,
        file_name: a.file_name,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        storage_path: a.storage_path,
        signed_url: signedUrlMap.get(a.storage_path) ?? null,
      })),
    }));

  // Stitch each member to its separately-fetched profile (see the
  // no-FK note above).
  const companyMemberList = (
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

  const conversationList = ((conversations ?? []) as Array<{
    id: string;
    kind: string;
    name: string | null;
    is_default: boolean;
    created_at: string;
    members: { user_id: string }[];
  }>).map((c) => ({
    id: c.id,
    kind: c.kind as "channel" | "group" | "dm",
    name: c.name,
    is_default: c.is_default,
    created_at: c.created_at,
    member_ids: c.members.map((m) => m.user_id),
  }));

  const conversationMemberIds = (
    (convMembers ?? []) as Array<{ user_id: string }>
  ).map((m) => m.user_id);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          Team chat
        </div>
        <h1 className="display mt-2 text-2xl sm:text-3xl text-forest-900">
          {company.name}
        </h1>

        <div className="mt-5">
          <ChatShell
            companyId={company.id}
            companyPublicId={publicId}
            companyName={company.name}
            currentUserId={user.id}
            isManager={isManager}
            conversation={{
              id: conversation.id,
              kind: conversation.kind as "channel" | "group" | "dm",
              name: conversation.name,
              is_default: conversation.is_default,
            }}
            conversations={conversationList}
            companyMembers={companyMemberList}
            conversationMemberIds={conversationMemberIds}
            initialMessages={initialMessages}
            sendAction={sendMessage}
            deleteAction={deleteMessage}
            createGroupAction={createGroup}
            createDmAction={createOrOpenDm}
            addGroupMemberAction={addGroupMember}
            removeGroupMemberAction={removeGroupMember}
            leaveAction={leaveConversation}
            canManageMembers={
              conversation.kind === "group" &&
              (conversation.created_by === user.id || isManager)
            }
          />
        </div>
      </section>
    </main>
  );
}
