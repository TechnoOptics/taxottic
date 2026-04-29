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
  leaveAction: (formData: FormData) => Promise<void>;
};

/**
 * Two-column chat shell: conversation sidebar (channels / groups /
 * DMs) on the left, the active conversation on the right. Stacks on
 * narrow screens.
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
  leaveAction,
}: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
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
        leaveAction={leaveAction}
      />
    </div>
  );
}
