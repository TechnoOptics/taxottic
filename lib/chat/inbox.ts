/**
 * Shapes the chat inbox: one row per conversation the user can see,
 * ordered by most recent activity.
 *
 * Pure on purpose. The page fetches (RLS already decides what the user
 * is allowed to see) and this decides how it reads. That split is what
 * makes the titling, previewing and unread rules testable without a
 * database.
 */

export type ConversationKind = "channel" | "group" | "dm";

export type InboxMember = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

export type InboxConversation = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  is_default: boolean;
  created_at: string;
  member_ids: string[];
};

export type InboxMessage = {
  conversation_id: string;
  user_id: string;
  body: string;
  created_at: string;
  has_attachment: boolean;
};

export type InboxRow = {
  id: string;
  kind: ConversationKind;
  /** Group / channel name, or the other person's name for a DM. */
  title: string;
  /** Last message, prefixed with its author outside of DMs. */
  preview: string;
  /** ISO timestamp of the last message, or null when there is none. */
  lastActivity: string | null;
  unread: boolean;
  /** The other participant in a DM, for the monogram. Null otherwise. */
  otherUserId: string | null;
  memberCount: number;
};

const PREVIEW_MAX = 90;

export function displayNameFor(member: InboxMember | undefined): string {
  if (!member) return "Teammate";
  if (member.full_name) return member.full_name;
  if (member.email) return member.email.split("@")[0];
  return "Teammate";
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_MAX) return flat;
  return `${flat.slice(0, PREVIEW_MAX - 3).trimEnd()}...`;
}

/**
 * Latest message per conversation. `messages` may arrive in any order
 * and may cover only the most recent slice of history, so a
 * conversation with no entry simply has no preview.
 */
export function latestByConversation(
  messages: InboxMessage[],
): Map<string, InboxMessage> {
  const latest = new Map<string, InboxMessage>();
  for (const m of messages) {
    const current = latest.get(m.conversation_id);
    if (!current || m.created_at > current.created_at) {
      latest.set(m.conversation_id, m);
    }
  }
  return latest;
}

export function buildInbox({
  conversations,
  messages,
  members,
  currentUserId,
  readAt,
}: {
  conversations: InboxConversation[];
  messages: InboxMessage[];
  members: InboxMember[];
  currentUserId: string;
  /** conversation_id -> ISO timestamp this user last opened it. */
  readAt: Map<string, string>;
}): InboxRow[] {
  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const latest = latestByConversation(messages);

  const rows = conversations.map<InboxRow>((c) => {
    const last = latest.get(c.id);
    const otherUserId =
      c.kind === "dm"
        ? (c.member_ids.find((id) => id !== currentUserId) ?? null)
        : null;

    const title =
      c.kind === "dm"
        ? displayNameFor(
            otherUserId ? memberById.get(otherUserId) : undefined,
          )
        : (c.name ?? (c.kind === "channel" ? "Channel" : "Group"));

    let preview: string;
    if (!last) {
      preview =
        c.kind === "dm" ? "No messages yet" : "Nothing posted here yet";
    } else {
      const body = last.body.trim()
        ? last.body
        : last.has_attachment
          ? "Sent a file"
          : "";
      if (c.kind === "dm") {
        preview = truncate(
          last.user_id === currentUserId ? `You: ${body}` : body,
        );
      } else {
        const who =
          last.user_id === currentUserId
            ? "You"
            : displayNameFor(memberById.get(last.user_id));
        preview = truncate(`${who}: ${body}`);
      }
    }

    // Your own message is never unread, and a conversation you have
    // never opened only counts as unread if somebody actually said
    // something in it.
    const seenAt = readAt.get(c.id);
    const unread = Boolean(
      last &&
        last.user_id !== currentUserId &&
        (!seenAt || seenAt < last.created_at),
    );

    return {
      id: c.id,
      kind: c.kind,
      title,
      preview,
      lastActivity: last?.created_at ?? null,
      unread,
      otherUserId,
      memberCount:
        c.kind === "channel" ? members.length : c.member_ids.length,
    };
  });

  // Most recent activity first. Conversations nobody has posted in
  // fall back to when they were created, so a brand new group still
  // appears at the top of the list that created it.
  const sortKey = (r: InboxRow) =>
    r.lastActivity ??
    conversations.find((c) => c.id === r.id)?.created_at ??
    "";

  return rows.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}
