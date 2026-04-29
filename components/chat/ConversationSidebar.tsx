"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Monogram, displayName } from "./Monogram";
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
 * Left-rail conversation list, Microsoft Teams style:
 *   [Channels]
 *     # General  (default channel)
 *   [Groups]    + new
 *     · Marketing
 *   [Direct messages]    + new
 *     · Jordan
 *     · Sam
 *
 * Sections collapse if empty (no "Groups" header until there's at
 * least one). Two modal dialogs hang off the + buttons: one to create
 * a group with a multi-select member picker, and one to start a DM
 * with a single teammate.
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
        {/* Channels */}
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

        {/* Groups */}
        <SectionHeader
          label="Groups"
          action={
            <button
              type="button"
              onClick={() => setShowNewGroup(true)}
              className="text-[11px] text-forest-700 hover:text-forest-900"
            >
              + New
            </button>
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

        {/* Direct messages */}
        <SectionHeader
          label="Direct messages"
          action={
            <button
              type="button"
              onClick={() => setShowNewDm(true)}
              className="text-[11px] text-forest-700 hover:text-forest-900"
            >
              + New
            </button>
          }
        />
        <ul className="grid gap-0.5 mt-1">
          {dms.length === 0 ? (
            <li className="px-2.5 py-1.5 text-xs text-ink-muted italic">
              No DMs yet.
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

function SectionHeader({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mt-3 first:mt-0 px-2.5">
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
      className={
        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors " +
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
          {kind === "channel" ? "#" : kind === "group" ? "•" : "@"}
        </span>
      )}
      <span className="truncate flex-1">{children}</span>
    </Link>
  );
}

// =============================================================================
// New Group dialog
// =============================================================================
function NewGroupDialog({
  companyId,
  companyMembers,
  onClose,
  action,
}: {
  companyId: string;
  companyMembers: CompanyMember[];
  onClose: () => void;
  action: (formData: FormData) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the group a name.");
      return;
    }
    if (selected.size === 0) {
      setError("Pick at least one teammate.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("company_id", companyId);
      fd.set("name", name.trim());
      for (const id of selected) fd.append("member_ids", id);
      await action(fd);
      // The action redirects on success.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group.");
      setSubmitting(false);
    }
  }

  return (
    <DialogShell onClose={onClose} title="New group">
      <form onSubmit={onSubmit} className="grid gap-4 mt-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-forest-800">Group name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            placeholder="e.g. Marketing"
            maxLength={80}
            autoFocus
          />
        </label>
        <div>
          <span className="text-sm font-medium text-forest-800">
            Add members
          </span>
          <p className="text-xs text-ink-muted mt-0.5">
            You're added automatically. Pick anyone else from your team.
          </p>
          <ul className="mt-2 grid gap-1 max-h-64 overflow-y-auto no-scrollbar pr-1">
            {companyMembers.map((m) => {
              const checked = selected.has(m.user_id);
              return (
                <li key={m.user_id}>
                  <label
                    className={
                      "flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer text-sm " +
                      (checked
                        ? "border-forest-800 bg-forest-800 text-cream"
                        : "border-forest-100 hover:border-forest-300")
                    }
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggle(m.user_id)}
                    />
                    <Monogram userId={m.user_id} member={m} size={28} />
                    <span className="flex-1 truncate">
                      {displayName(m)}
                    </span>
                    {checked ? <span className="text-xs">✓</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Creating..." : "Create group"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

// =============================================================================
// New DM dialog
// =============================================================================
function NewDmDialog({
  companyId,
  companyMembers,
  onClose,
  action,
}: {
  companyId: string;
  companyMembers: CompanyMember[];
  onClose: () => void;
  action: (formData: FormData) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companyMembers;
    return companyMembers.filter((m) => {
      const name = (m.full_name ?? "").toLowerCase();
      const email = (m.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [search, companyMembers]);

  async function start(otherId: string) {
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("company_id", companyId);
      fd.set("other_user_id", otherId);
      await action(fd);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start chat.");
      setSubmitting(false);
    }
  }

  return (
    <DialogShell onClose={onClose} title="Start a direct message">
      <div className="grid gap-3 mt-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
          placeholder="Search by name or email"
          autoFocus
        />
        <ul className="grid gap-1 max-h-72 overflow-y-auto no-scrollbar pr-1">
          {filtered.map((m) => (
            <li key={m.user_id}>
              <button
                type="button"
                onClick={() => start(m.user_id)}
                disabled={submitting}
                className="w-full flex items-center gap-3 rounded-lg border border-forest-100 hover:border-forest-300 px-3 py-2 text-sm text-left disabled:opacity-50"
              >
                <Monogram userId={m.user_id} member={m} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-forest-900 truncate">
                    {displayName(m)}
                  </div>
                  {m.email ? (
                    <div className="text-xs text-ink-muted truncate">
                      {m.email}
                    </div>
                  ) : null}
                </div>
                <span className="text-[10px] uppercase tracking-wide text-gold-700">
                  Chat
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-sm text-ink-muted text-center">
              No teammates match.
            </li>
          ) : null}
        </ul>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
    </DialogShell>
  );
}

// =============================================================================
// Generic dialog shell (no overlay layout libs to keep weight down)
// =============================================================================
function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 grid place-items-center px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-forest-900/45 backdrop-blur-sm" />
      <div
        className="card relative w-full max-w-md p-6 sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 size-8 rounded-full grid place-items-center text-ink-muted hover:bg-cream"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M3 3 L13 13 M13 3 L3 13" />
          </svg>
        </button>
        <h2 className="display text-2xl text-forest-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}
