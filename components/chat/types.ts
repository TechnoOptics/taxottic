// Shared types for the team chat surface. Kept in one file so the
// server page, the shell, the sidebar, and the conversation view all
// reason about the same shapes.

export type ConversationKind = "channel" | "group" | "dm";

export type CompanyMember = {
  user_id: string;
  role: string;
  full_name: string | null;
  email: string | null;
};

export type ConversationListItem = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  is_default: boolean;
  created_at: string;
  /** All explicit members. Empty for channels (everyone is a member). */
  member_ids: string[];
};

export type ChatAttachment = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  /** 1-hour signed URL generated server-side. Client refreshes it for
   *  attachments uploaded after page load. */
  signed_url: string | null;
};

export type ChatMessage = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  attachments: ChatAttachment[];
};
