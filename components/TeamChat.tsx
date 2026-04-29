"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type ChatMessage = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type ChatMember = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

/**
 * Team chat panel. Server hydrates the initial message list (last 200);
 * we subscribe to Postgres realtime for INSERTs and DELETEs scoped to
 * this company so the room stays live across all members.
 *
 * Author display: full_name -> email handle -> "Teammate". Avatars are
 * a colored monogram circle derived deterministically from the user ID
 * so two members with similar names still get distinct avatars.
 */
export function TeamChat({
  companyId,
  companyName,
  currentUserId,
  initialMessages,
  members,
  sendAction,
  deleteAction,
  isManager,
}: {
  companyId: string;
  companyName: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
  members: ChatMember[];
  sendAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  isManager: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const memberById = useMemo(() => {
    const m = new Map<string, ChatMember>();
    for (const x of members) m.set(x.user_id, x);
    return m;
  }, [members]);

  // Realtime: subscribe to inserts + deletes for our company. We filter
  // server-side via the channel filter so other companies' chatter
  // doesn't even hit our client.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`team_messages:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const m = payload.new as ChatMessage;
          setMessages((prev) =>
            // De-dupe in case our own server-action insert has already
            // landed via revalidate-then-realtime.
            prev.some((x) => x.id === m.id) ? prev : [...prev, m],
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "team_messages",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const old = payload.old as { id: string };
          setMessages((prev) => prev.filter((x) => x.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  // Autoscroll to the latest message whenever the list grows.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // requestAnimationFrame so the DOM has the new node before we scroll.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length]);

  async function onSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("company_id", companyId);
      fd.set("body", draft.trim());
      await sendAction(fd);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  // Group messages so consecutive messages from the same author within
  // ~5 minutes share a single header (looks like iMessage / Slack).
  const grouped = useMemo(() => {
    const out: { authorId: string; first: ChatMessage; items: ChatMessage[] }[] = [];
    for (const m of messages) {
      const last = out[out.length - 1];
      const sameAuthor = last && last.authorId === m.user_id;
      const within = last
        ? new Date(m.created_at).getTime() -
            new Date(last.first.created_at).getTime() <
          5 * 60 * 1000
        : false;
      if (sameAuthor && within && last) {
        last.items.push(m);
      } else {
        out.push({ authorId: m.user_id, first: m, items: [m] });
      }
    }
    return out;
  }, [messages]);

  return (
    <div className="card flex flex-col h-[68vh] min-h-[480px] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-forest-100 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
            Team chat
          </div>
          <div className="display text-lg text-forest-900 mt-0.5">
            #{slugify(companyName)}
          </div>
        </div>
        <div className="text-xs text-ink-muted">
          {members.length} member{members.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 sm:px-5 py-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="h-full grid place-items-center text-center px-6">
            <div>
              <div className="display text-xl text-forest-900">
                Quiet in here.
              </div>
              <p className="mt-2 text-sm text-ink-soft max-w-sm">
                Say hello, share a deadline, or ping a teammate. Everyone in{" "}
                <span className="text-forest-800 font-medium">
                  {companyName}
                </span>{" "}
                will see it.
              </p>
            </div>
          </div>
        ) : (
          <ul className="grid gap-4">
            {grouped.map((g, i) => {
              const author = memberById.get(g.authorId);
              const isMe = g.authorId === currentUserId;
              return (
                <li key={i} className="flex items-start gap-3">
                  <Monogram userId={g.authorId} name={author?.full_name ?? author?.email ?? null} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={
                          "text-sm font-medium " +
                          (isMe ? "text-forest-900" : "text-forest-800")
                        }
                      >
                        {displayName(author) ?? "Teammate"}
                        {isMe ? (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gold-700">
                            you
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[11px] text-ink-muted">
                        {formatTime(g.first.created_at)}
                      </span>
                    </div>
                    <div className="mt-1 grid gap-1">
                      {g.items.map((m) => (
                        <div
                          key={m.id}
                          className="group flex items-start gap-2"
                        >
                          <p className="text-sm text-ink whitespace-pre-wrap break-words leading-relaxed flex-1">
                            {m.body}
                          </p>
                          {(isMe || isManager) ? (
                            <form action={deleteAction}>
                              <input
                                type="hidden"
                                name="company_id"
                                value={companyId}
                              />
                              <input
                                type="hidden"
                                name="message_id"
                                value={m.id}
                              />
                              <button
                                aria-label="Delete message"
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-ink-muted hover:text-red-700"
                              >
                                Delete
                              </button>
                            </form>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={onSend}
        className="border-t border-forest-100 px-4 sm:px-5 py-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter inserts a newline. Standard.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            placeholder={`Message everyone at ${companyName}`}
            className="input resize-none py-2 leading-relaxed flex-1"
            style={{ minHeight: "2.75rem", maxHeight: "10rem" }}
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="btn-primary"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-red-700">{error}</p>
        ) : (
          <p className="mt-2 text-[11px] text-ink-muted">
            Press Enter to send, Shift+Enter for a new line.
          </p>
        )}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function displayName(member: ChatMember | undefined): string | null {
  if (!member) return null;
  if (member.full_name) return member.full_name;
  if (member.email) return member.email.split("@")[0];
  return null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// Deterministic palette for the monogram avatar. Indexed by a tiny hash
// of the user id so the same teammate always gets the same color.
const MONOGRAM_PALETTE = [
  { bg: "#0f2d24", fg: "#fbf7e9" }, // forest
  { bg: "#5e3812", fg: "#fbf7e9" }, // bronze
  { bg: "#6a4612", fg: "#fbf7e9" }, // gold
  { bg: "#234e39", fg: "#fbf7e9" }, // forest-600
  { bg: "#356a4d", fg: "#fbf7e9" }, // forest-500
  { bg: "#a78540", fg: "#0f2d24" }, // gold-600
];

function Monogram({
  userId,
  name,
}: {
  userId: string;
  name: string | null;
}) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  const palette = MONOGRAM_PALETTE[h % MONOGRAM_PALETTE.length];
  return (
    <div
      className="size-9 rounded-full grid place-items-center text-sm font-semibold shrink-0"
      style={{ background: palette.bg, color: palette.fg }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}
