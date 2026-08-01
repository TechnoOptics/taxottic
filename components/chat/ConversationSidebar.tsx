"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Monogram, displayName } from "./Monogram";
import { NewDmDialog, NewGroupDialog } from "./NewConversationDialogs";
import type {
  CompanyMember,
  ConversationKind,
  ConversationListItem,
} from "./types";

type Props = {
  companyId: string;
  companyPublicId: string;
  currentUserId: string;
  conversations: ConversationListItem[];
  companyMembers: CompanyMember[];
  activeConversationId: string;
  createGroupAction: (formData: FormData) => Promise<void>;
  createDmAction: (formData: FormData) => Promise<void>;
};

/**
 * Desktop left rail listing every conversation, so you can hop between
 * them without going back to the inbox. On narrow screens ChatShell
 * hides this entirely and the inbox at /chat plays the same role,
 * which keeps the conversation itself full-width on a phone.
 */
export function ConversationSidebar({
  companyId,
  companyPublicId,
  currentUserId,
  conversations,
  companyMembers,
  activeConversationId,
  createGroupAction,
  createDmAction,
}: Props) {
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);

  const memberById = useMemo(() => {
    const m = new Map<string, CompanyMember>();
    for (const x of companyMembers) m.set(x.user_id, x);
    return m;
  }, [companyMembers]);

  const channels = conversations.filter((c) => c.kind === "channel");
  const groups = conversations.filter((c) => c.kind === "group");
  const dms = conversations.filter((c) => c.kind === "dm");

  function dmLabel(c: ConversationListItem): {
    label: string;
    other: CompanyMember | undefined;
  } {
    const otherId = c.member_ids.find((id) => id !== currentUserId);
    const other = otherId ? memberById.get(otherId) : undefined;
    return { label: displayName(other), other };
  }

  return (
    <>
      <aside className="card p-3 sm:p-4 h-full overflow-y-auto no-scrollbar">
        <Link
          href={`/c/${companyPublicId}/chat`}
          className="flex items-center gap-1.5 min-h-11 px-2 text-xs text-ink-soft hover:text-forest-900"
        >
          <BackIcon />
          All chats
        </Link>

        <SectionHeader label="Channels" />
        <ul className="grid gap-0.5 mt-1">
          {channels.map((c) => (
            <li key={c.id}>
              <ConversationLink
                href={`/c/${companyPublicId}/chat/${c.id}`}
                active={c.id === activeConversationId}
                kind="channel"
              >
                {c.name ?? "Channel"}
              </ConversationLink>
            </li>
          ))}
        </ul>

        <SectionHeader
          label="Groups"
          action={
            <NewButton label="New group" onClick={() => setShowNewGroup(true)} />
          }
        />
        <ul className="grid gap-0.5 mt-1">
          {groups.length === 0 ? (
            <li className="px-2.5 py-1.5 text-xs text-ink-muted italic">
              No groups yet.
            </li>
          ) : (
            groups.map((c) => (
              <li key={c.id}>
                <ConversationLink
                  href={`/c/${companyPublicId}/chat/${c.id}`}
                  active={c.id === activeConversationId}
                  kind="group"
                >
                  {c.name ?? "Group"}
                </ConversationLink>
              </li>
            ))
          )}
        </ul>

        <SectionHeader
          label="Direct messages"
          action={
            <NewButton label="New message" onClick={() => setShowNewDm(true)} />
          }
        />
        <ul className="grid gap-0.5 mt-1">
          {dms.length === 0 ? (
            <li className="px-2.5 py-1.5 text-xs text-ink-muted italic">
              No direct messages yet.
            </li>
          ) : (
            dms.map((c) => {
              const { label, other } = dmLabel(c);
              return (
                <li key={c.id}>
                  <ConversationLink
                    href={`/c/${companyPublicId}/chat/${c.id}`}
                    active={c.id === activeConversationId}
                    kind="dm"
                    avatar={
                      other ? (
                        <Monogram
                          userId={other.user_id}
                          member={other}
                          size={22}
                        />
                      ) : null
                    }
                  >
                    {label}
                  </ConversationLink>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      {showNewGroup ? (
        <NewGroupDialog
          companyId={companyId}
          companyMembers={companyMembers.filter(
            (m) => m.user_id !== currentUserId,
          )}
          onClose={() => setShowNewGroup(false)}
          action={createGroupAction}
        />
      ) : null}
      {showNewDm ? (
        <NewDmDialog
          companyId={companyId}
          companyMembers={companyMembers.filter(
            (m) => m.user_id !== currentUserId,
          )}
          onClose={() => setShowNewDm(false)}
          action={createDmAction}
        />
      ) : null}
    </>
  );
}

function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="size-11 -mr-2 grid place-items-center rounded-lg text-forest-700 hover:bg-cream/70 hover:text-forest-900"
    >
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M10 4v12M4 10h12" />
      </svg>
    </button>
  );
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4 L6 10 L12 16" />
    </svg>
  );
}

function SectionHeader({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mt-2 px-2.5 min-h-9">
      <span className="text-[10px] uppercase tracking-[0.22em] text-gold-700 font-medium">
        {label}
      </span>
      {action}
    </div>
  );
}

function ConversationLink({
  href,
  active,
  kind,
  children,
  avatar,
}: {
  href: string;
  active: boolean;
  kind: ConversationKind;
  children: React.ReactNode;
  avatar?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        "flex items-center gap-2 rounded-lg px-2.5 min-h-11 text-sm transition-colors " +
        (active
          ? "bg-forest-800 text-cream"
          : "text-forest-900 hover:bg-cream/70")
      }
    >
      {avatar ? (
        avatar
      ) : (
        <span
          className={
            "inline-grid place-items-center size-5 rounded shrink-0 text-[11px] font-semibold " +
            (active ? "bg-cream/15 text-cream" : "text-forest-700 bg-forest-100")
          }
          aria-hidden="true"
        >
          {kind === "channel" ? "#" : kind === "group" ? "·" : "@"}
        </span>
      )}
      <span className="truncate flex-1">{children}</span>
    </Link>
  );
}
