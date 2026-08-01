"use client";

import { ConversationSidebar } from "./ConversationSidebar";
import { ConversationView } from "./ConversationView";
import type {
  ChatMessage,
  CompanyMember,
  ConversationKind,
  ConversationListItem,
} from "./types";

type Conversation = {
  id: string;
  kind: ConversationKind;
  name: string | null;
  is_default: boolean;
};

type Props = {
  companyId: string;
  companyPublicId: string;
  companyName: string;
  currentUserId: string;
  isManager: boolean;
  conversation: Conversation;
  conversations: ConversationListItem[];
  companyMembers: CompanyMember[];
  conversationMemberIds: string[];
  initialMessages: ChatMessage[];
  sendAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  createGroupAction: (formData: FormData) => Promise<void>;
  createDmAction: (formData: FormData) => Promise<void>;
  addGroupMemberAction: (formData: FormData) => Promise<void>;
  removeGroupMemberAction: (formData: FormData) => Promise<void>;
  leaveAction: (formData: FormData) => Promise<void>;
  /** Group creator, or a company manager: may remove other members. */
  canManageMembers: boolean;
};

/**
 * Two-column chat shell: conversation sidebar (channels / groups /
 * DMs) on the left, the active conversation on the right.
 *
 * The sidebar is desktop-only. On a phone it used to stack above the
 * conversation as a tall card, pushing the messages off screen and
 * costing most of a 344px viewport; the inbox at /chat does that job
 * now, reached from the header's back link.
 */
export function ChatShell({
  companyId,
  companyPublicId,
  currentUserId,
  isManager,
  conversation,
  conversations,
  companyMembers,
  conversationMemberIds,
  initialMessages,
  sendAction,
  deleteAction,
  createGroupAction,
  createDmAction,
  addGroupMemberAction,
  removeGroupMemberAction,
  leaveAction,
  canManageMembers,
}: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <div className="hidden md:block">
        <ConversationSidebar
          companyId={companyId}
          companyPublicId={companyPublicId}
          currentUserId={currentUserId}
          conversations={conversations}
          companyMembers={companyMembers}
          activeConversationId={conversation.id}
          createGroupAction={createGroupAction}
          createDmAction={createDmAction}
        />
      </div>
      <ConversationView
        companyId={companyId}
        companyPublicId={companyPublicId}
        conversation={conversation}
        currentUserId={currentUserId}
        isManager={isManager}
        companyMembers={companyMembers}
        conversationMemberIds={conversationMemberIds}
        initialMessages={initialMessages}
        sendAction={sendAction}
        deleteAction={deleteAction}
        addGroupMemberAction={addGroupMemberAction}
        removeGroupMemberAction={removeGroupMemberAction}
        leaveAction={leaveAction}
        canManageMembers={canManageMembers}
      />
    </div>
  );
}
