"use client";

import { useState } from "react";
import Link from "next/link";
import { Monogram } from "./Monogram";
import { NewDmDialog, NewGroupDialog } from "./NewConversationDialogs";
import type { CompanyMember } from "./types";
import type { InboxRow } from "@/lib/chat/inbox";

type Props = {
  companyId: string;
  companyPublicId: string;
  currentUserId: string;
  rows: InboxRow[];
  companyMembers: CompanyMember[];
  createGroupAction: (formData: FormData) => Promise<void>;
  createDmAction: (formData: FormData) => Promise<void>;
};

/**
 * The chat landing surface: your conversations, most recent first,
 * with starting a new one as the primary action.
 *
 * This route used to redirect straight into the company's General
 * channel, which is why the owner experienced chat as a single room
 * that "does not make sense". General is still here, unchanged, but as
 * one row among the rest rather than the only destination.
 */
export function ChatInbox({
  companyId,
  companyPublicId,
  currentUserId,
  rows,
  companyMembers,
  createGroupAction,
  createDmAction,
}: Props) {
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);

  const teammates = companyMembers.filter((m) => m.user_id !== currentUserId);
  const memberById = new Map(companyMembers.map((m) => [m.user_id, m]));
  const hasDirect = rows.some((r) => r.kind === "dm" || r.kind === "group");

  return (
    <>
      <div className="grid gap-3 sm:flex sm:items-center sm:gap-3">
        <button
          type="button"
          onClick={() => setShowNewDm(true)}
          className="btn-primary min-h-11 inline-flex items-center justify-center gap-2"
        >
          <PersonPlusIcon />
          New message
        </button>
        <button
          type="button"
          onClick={() => setShowNewGroup(true)}
          className="btn-ghost min-h-11 inline-flex items-center justify-center gap-2"
        >
          <GroupIcon />
          New group
        </button>
      </div>

      {teammates.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft max-w-prose">
          You are the only person on this company right now, so there is
          nobody to message yet. Add a teammate under Team and they will
          appear here.
        </p>
      ) : !hasDirect ? (
        <p className="mt-4 text-sm text-ink-soft max-w-prose">
          Message someone one to one, or make a private group for a few of
          you. Only the people in a conversation can read it.
        </p>
      ) : null}

      <ul className="card mt-5 divide-y divide-forest-100 overflow-hidden">
        {rows.length === 0 ? (
          <li className="px-4 py-8 text-sm text-ink-muted text-center">
            No conversations yet.
          </li>
        ) : (
          rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/c/${companyPublicId}/chat/${row.id}`}
                className="flex items-center gap-3 px-3 sm:px-4 py-3 min-h-[60px] hover:bg-cream/60 transition-colors"
              >
                {row.kind === "dm" && row.otherUserId ? (
                  <Monogram
                    userId={row.otherUserId}
                    member={memberById.get(row.otherUserId)}
                    size={40}
                  />
                ) : (
                  // Explicit colours, like Monogram's: the dark theme
                  // remaps forest utilities and a token pair here goes
                  // light-on-light. This reads the same either way.
                  <span
                    className="inline-grid place-items-center size-10 shrink-0 rounded-full"
                    style={{ background: "#2f3e63", color: "#fbf7e9" }}
                    aria-hidden="true"
                  >
                    {row.kind === "channel" ? <HashIcon /> : <GroupIcon />}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={
                        "truncate text-sm " +
                        (row.unread
                          ? "font-semibold text-forest-900"
                          : "font-medium text-forest-800")
                      }
                    >
                      {row.title}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-ink-muted">
                      {formatStamp(row.lastActivity)}
                      {row.unread ? (
                        <span
                          className="size-2 rounded-full bg-gold-600"
                          role="img"
                          aria-label="Unread"
                        />
                      ) : null}
                    </span>
                  </div>
                  <span
                    className={
                      "block truncate text-xs " +
                      (row.unread ? "text-forest-800" : "text-ink-muted")
                    }
                  >
                    {row.preview}
                  </span>
                </div>
              </Link>
            </li>
          ))
        )}
      </ul>

      <p className="mt-3 text-[11px] text-ink-muted">
        Direct messages and private groups are readable only by the people in
        them. Channels are open to everyone on this company.
      </p>

      {showNewGroup ? (
        <NewGroupDialog
          companyId={companyId}
          companyMembers={teammates}
          onClose={() => setShowNewGroup(false)}
          action={createGroupAction}
        />
      ) : null}
      {showNewDm ? (
        <NewDmDialog
          companyId={companyId}
          companyMembers={teammates}
          onClose={() => setShowNewDm(false)}
          action={createDmAction}
        />
      ) : null}
    </>
  );
}

function formatStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

function PersonPlusIcon() {
  return (
    <Glyph>
      <circle cx="8" cy="6.5" r="3" />
      <path d="M2.5 16.5c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" />
      <path d="M15.5 5.5v5M13 8h5" />
    </Glyph>
  );
}

function GroupIcon() {
  return (
    <Glyph>
      <circle cx="7" cy="7" r="2.6" />
      <circle cx="14" cy="7.5" r="2.1" />
      <path d="M2 16c0-2.7 2.2-4 5-4s5 1.3 5 4" />
      <path d="M13.5 12.2c2.5.2 4.5 1.5 4.5 3.8" />
    </Glyph>
  );
}

function HashIcon() {
  return (
    <Glyph>
      <path d="M7 3 L5.5 17 M13 3 L11.5 17 M3.5 7.5 H16 M3 12.5 H15.5" />
    </Glyph>
  );
}

/** Stroke icons inherit currentColor: raw hex is not remapped on the
 *  dark-themed authenticated pages. */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}
