"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";

// ============================================================================
// Helpers
// ============================================================================

async function assertCompanyMember(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  userId: string,
  companyId: string,
) {
  const { data } = await admin
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Not a member of this company");
}

async function assertConversationAccess(
  admin: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  userId: string,
  conversationId: string,
): Promise<{ companyId: string; companyPublicId: string; kind: string }> {
  const { data: conv } = await admin
    .from("chat_conversations")
    .select(
      "id, company_id, kind, companies:companies!inner(public_id)",
    )
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv) throw new Error("Conversation not found");

  // For channels, company membership is enough; for groups/dms we
  // require an explicit conversation_members row.
  if (conv.kind === "channel") {
    await assertCompanyMember(admin, userId, conv.company_id);
  } else {
    const { data: membership } = await admin
      .from("chat_conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) throw new Error("You are not a member of this chat");
  }

  const company = conv.companies as unknown as { public_id: string };
  return {
    companyId: conv.company_id,
    companyPublicId: company.public_id,
    kind: conv.kind,
  };
}

// ============================================================================
// Conversation lifecycle
// ============================================================================

/**
 * Create a private named group with a chosen list of company-member IDs.
 * The creator is automatically added.
 */
export async function createGroup(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  // Multi-select hidden inputs send repeated entries.
  const memberIds = Array.from(new Set(formData.getAll("member_ids").map(String)))
    .filter((s) => s && s !== user.id);

  if (!companyId || !name) throw new Error("Missing input");
  if (name.length > 80) throw new Error("Name is too long");

  await assertCompanyMember(admin, user.id, companyId);

  // Verify each requested member is actually in this company.
  if (memberIds.length > 0) {
    const { data: validRows } = await admin
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .in("user_id", memberIds);
    const validSet = new Set((validRows ?? []).map((r) => r.user_id));
    for (const id of memberIds) {
      if (!validSet.has(id)) {
        throw new Error("One of the selected teammates isn't in this company.");
      }
    }
  }

  const { data: conv, error } = await admin
    .from("chat_conversations")
    .insert({
      company_id: companyId,
      kind: "group",
      name,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !conv) throw new Error(error?.message ?? "Insert failed");

  // Always include the creator. Use upsert to absorb duplicates.
  const memberRows = [
    { conversation_id: conv.id, user_id: user.id },
    ...memberIds.map((u) => ({ conversation_id: conv.id, user_id: u })),
  ];
  const { error: memberError } = await admin
    .from("chat_conversation_members")
    .upsert(memberRows, { onConflict: "conversation_id,user_id" });
  if (memberError) throw new Error(memberError.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/chat`);
    redirect(`/c/${company.public_id}/chat/${conv.id}`);
  }
}

/**
 * Open (or reuse) a 1:1 DM between the current user and a target user.
 * If a DM already exists between these two within this company, return
 * its id rather than creating a duplicate.
 */
export async function createOrOpenDm(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const otherUserId = String(formData.get("other_user_id") ?? "");

  if (!companyId || !otherUserId) throw new Error("Missing input");
  if (otherUserId === user.id) {
    throw new Error("You can't start a DM with yourself.");
  }

  await assertCompanyMember(admin, user.id, companyId);
  await assertCompanyMember(admin, otherUserId, companyId);

  // Look for an existing DM by intersecting members.
  const { data: candidates } = await admin
    .from("chat_conversations")
    .select(
      "id, kind, members:chat_conversation_members!inner(user_id)",
    )
    .eq("company_id", companyId)
    .eq("kind", "dm");

  type CandidateRow = { id: string; members: { user_id: string }[] };
  const existing = ((candidates ?? []) as unknown as CandidateRow[]).find(
    (c) => {
      const ids = new Set(c.members.map((m) => m.user_id));
      return ids.size === 2 && ids.has(user.id) && ids.has(otherUserId);
    },
  );

  let conversationId = existing?.id;

  if (!conversationId) {
    const { data: conv, error } = await admin
      .from("chat_conversations")
      .insert({
        company_id: companyId,
        kind: "dm",
        name: null,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error || !conv) throw new Error(error?.message ?? "Insert failed");

    const { error: memberError } = await admin
      .from("chat_conversation_members")
      .insert([
        { conversation_id: conv.id, user_id: user.id },
        { conversation_id: conv.id, user_id: otherUserId },
      ]);
    if (memberError) throw new Error(memberError.message);
    conversationId = conv.id;
  }

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) {
    revalidatePath(`/c/${company.public_id}/chat`);
    redirect(`/c/${company.public_id}/chat/${conversationId}`);
  }
}

/**
 * Add an additional company member to an existing group. Channels
 * already include everyone; DMs are 2-only and reject this.
 */
export async function addGroupMember(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const conversationId = String(formData.get("conversation_id") ?? "");
  const newUserId = String(formData.get("user_id") ?? "");
  if (!conversationId || !newUserId) throw new Error("Missing input");

  const ctx = await assertConversationAccess(admin, user.id, conversationId);
  if (ctx.kind === "dm") {
    throw new Error("DMs are limited to two participants.");
  }
  if (ctx.kind === "channel") {
    throw new Error("Channels include all company members automatically.");
  }
  await assertCompanyMember(admin, newUserId, ctx.companyId);

  const { error } = await admin
    .from("chat_conversation_members")
    .upsert(
      [{ conversation_id: conversationId, user_id: newUserId }],
      { onConflict: "conversation_id,user_id" },
    );
  if (error) throw new Error(error.message);

  revalidatePath(`/c/${ctx.companyPublicId}/chat`);
  revalidatePath(`/c/${ctx.companyPublicId}/chat/${conversationId}`);
}

/**
 * Leave a group / DM. Channels can't be left (you'd need to leave the
 * company itself).
 */
export async function leaveConversation(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const conversationId = String(formData.get("conversation_id") ?? "");
  if (!conversationId) throw new Error("Missing input");

  const ctx = await assertConversationAccess(admin, user.id, conversationId);
  if (ctx.kind === "channel") {
    throw new Error("Channels are open to all company members.");
  }

  const { error } = await admin
    .from("chat_conversation_members")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath(`/c/${ctx.companyPublicId}/chat`);
  redirect(`/c/${ctx.companyPublicId}/chat`);
}

// ============================================================================
// Messages + attachments
// ============================================================================

export type IncomingAttachment = {
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};

/**
 * Send a message. Body may be empty if at least one attachment is
 * provided. Attachments must already exist in storage; the action
 * inserts the metadata rows after the message row is created.
 *
 * Why a server action when storage uploads happen client-side? The
 * message + attachment metadata insertions are small, transactional,
 * and benefit from server-side membership re-checks before they
 * commit, so the realtime subscription only sees fully-formed records.
 */
export async function sendMessage(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const conversationId = String(formData.get("conversation_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const attachmentsRaw = String(formData.get("attachments") ?? "");

  let attachments: IncomingAttachment[] = [];
  if (attachmentsRaw) {
    try {
      const parsed = JSON.parse(attachmentsRaw);
      if (Array.isArray(parsed)) attachments = parsed;
    } catch {
      throw new Error("Bad attachments payload");
    }
  }

  if (!conversationId) throw new Error("Missing conversation");
  if (!body && attachments.length === 0) {
    throw new Error("Message is empty");
  }
  if (body.length > 4000) {
    throw new Error("Message is over the 4,000-character limit");
  }
  if (attachments.length > 10) {
    throw new Error("Maximum 10 attachments per message");
  }

  const ctx = await assertConversationAccess(admin, user.id, conversationId);

  const { data: msg, error } = await admin
    .from("team_messages")
    .insert({
      company_id: ctx.companyId,
      conversation_id: conversationId,
      user_id: user.id,
      body: body || "",
    })
    .select("id")
    .single();
  if (error || !msg) throw new Error(error?.message ?? "Insert failed");

  if (attachments.length > 0) {
    const rows = attachments.map((a) => ({
      message_id: msg.id,
      storage_path: a.storage_path,
      file_name: a.file_name.slice(0, 255),
      mime_type: a.mime_type.slice(0, 255),
      size_bytes: a.size_bytes,
    }));
    const { error: attError } = await admin
      .from("chat_attachments")
      .insert(rows);
    if (attError) throw new Error(attError.message);
  }

  revalidatePath(`/c/${ctx.companyPublicId}/chat/${conversationId}`);
}

export async function deleteMessage(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const conversationId = String(formData.get("conversation_id") ?? "");
  const messageId = String(formData.get("message_id") ?? "");
  if (!conversationId || !messageId) return;

  const ctx = await assertConversationAccess(admin, user.id, conversationId);

  const [{ data: msg }, { data: membership }] = await Promise.all([
    admin
      .from("team_messages")
      .select("user_id, company_id, conversation_id")
      .eq("id", messageId)
      .maybeSingle(),
    admin
      .from("company_members")
      .select("role")
      .eq("company_id", ctx.companyId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (!msg || msg.conversation_id !== conversationId) return;
  const isAuthor = msg.user_id === user.id;
  const isManager = membership?.role === "manager";
  if (!isAuthor && !isManager) {
    throw new Error("You can only delete your own messages.");
  }

  // Pull attachments first so we can clean their storage objects after
  // the row deletion cascades.
  const { data: atts } = await admin
    .from("chat_attachments")
    .select("storage_path")
    .eq("message_id", messageId);

  const { error } = await admin
    .from("team_messages")
    .delete()
    .eq("id", messageId);
  if (error) throw new Error(error.message);

  if (atts && atts.length > 0) {
    await admin.storage
      .from("chat-attachments")
      .remove(atts.map((a) => a.storage_path));
  }

  revalidatePath(`/c/${ctx.companyPublicId}/chat/${conversationId}`);
}
