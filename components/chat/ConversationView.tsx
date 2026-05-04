"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Monogram, displayName } from "./Monogram";
import type {
  ChatAttachment,
  ChatMessage,
  CompanyMember,
  ConversationKind,
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
  conversation: Conversation;
  currentUserId: string;
  isManager: boolean;
  companyMembers: CompanyMember[];
  conversationMemberIds: string[];
  initialMessages: ChatMessage[];
  sendAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  addGroupMemberAction: (formData: FormData) => Promise<void>;
  leaveAction: (formData: FormData) => Promise<void>;
};

// File limits matched to the migration's 25MB hard cap.
const MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

export function ConversationView({
  companyId,
  companyPublicId,
  conversation,
  currentUserId,
  isManager,
  companyMembers,
  conversationMemberIds,
  initialMessages,
  sendAction,
  deleteAction,
  addGroupMemberAction,
  leaveAction,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);

  const memberById = useMemo(() => {
    const m = new Map<string, CompanyMember>();
    for (const x of companyMembers) m.set(x.user_id, x);
    return m;
  }, [companyMembers]);

  // For channels, "everyone in the company" is the conversation
  // member set. For groups/dms, only those explicitly listed.
  const visibleMemberIds = useMemo(() => {
    if (conversation.kind === "channel") {
      return companyMembers.map((m) => m.user_id);
    }
    return conversationMemberIds;
  }, [conversation.kind, companyMembers, conversationMemberIds]);

  // Realtime: subscribe to inserts + deletes scoped to THIS conversation.
  useEffect(() => {
    const channel = supabase
      .channel(`conv:${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        async (payload) => {
          const m = payload.new as Omit<ChatMessage, "attachments">;
          // Pull attachments + signed URLs for the new message. New
          // realtime events arrive without their attachments joined,
          // so we ask for them and sign them here.
          const { data: atts } = await supabase
            .from("chat_attachments")
            .select("id, storage_path, file_name, mime_type, size_bytes")
            .eq("message_id", m.id);

          const paths = (atts ?? []).map((a) => a.storage_path);
          let signedMap = new Map<string, string>();
          if (paths.length > 0) {
            const { data: signed } = await supabase.storage
              .from("chat-attachments")
              .createSignedUrls(paths, 60 * 60);
            for (const s of signed ?? []) {
              if (s.path && s.signedUrl)
                signedMap.set(s.path, s.signedUrl);
            }
          }

          setMessages((prev) =>
            prev.some((x) => x.id === m.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: m.id,
                    user_id: m.user_id,
                    body: m.body,
                    created_at: m.created_at,
                    attachments: (atts ?? []).map((a) => ({
                      id: a.id,
                      file_name: a.file_name,
                      mime_type: a.mime_type,
                      size_bytes: a.size_bytes,
                      storage_path: a.storage_path,
                      signed_url: signedMap.get(a.storage_path) ?? null,
                    })),
                  },
                ],
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "team_messages",
          filter: `conversation_id=eq.${conversation.id}`,
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
  }, [conversation.id, supabase]);

  // Autoscroll to the latest message when the list grows.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length]);

  // -------------------------------------------------------------------
  // Attachment upload (client-side direct to storage, then attach to
  // message on send).
  // -------------------------------------------------------------------
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const newOnes: UploadedFile[] = [];

    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        setError(
          `${file.name} is over the 25 MB limit; please compress and try again.`,
        );
        continue;
      }
      // Sanitize filename: strip path separators + collapse weird chars
      // so the storage path stays predictable. Keep extension.
      const safeName = file.name
        .replace(/[/\\]/g, "-")
        .replace(/[^\w.\-]+/g, "_")
        .slice(0, 120);
      const path = `${companyPublicId}/${conversation.id}/${Date.now()}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("chat-attachments")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });
      if (upErr) {
        const msg = /row-level security/i.test(upErr.message)
          ? "You don't have access to this conversation's files."
          : upErr.message;
        setError(msg);
        continue;
      }
      // Sign for inline preview while pending.
      const { data: signed } = await supabase.storage
        .from("chat-attachments")
        .createSignedUrl(path, 60 * 60);
      newOnes.push({
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        signed_url: signed?.signedUrl ?? null,
      });
    }

    if (newOnes.length > 0) setPending((prev) => [...prev, ...newOnes]);
  }

  async function removePending(idx: number) {
    const target = pending[idx];
    if (!target) return;
    // Best-effort delete from storage so we don't keep the orphan.
    await supabase.storage
      .from("chat-attachments")
      .remove([target.storage_path]);
    setPending((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (!draft.trim() && pending.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("conversation_id", conversation.id);
      fd.set("body", draft);
      fd.set(
        "attachments",
        JSON.stringify(
          pending.map((p) => ({
            storage_path: p.storage_path,
            file_name: p.file_name,
            mime_type: p.mime_type,
            size_bytes: p.size_bytes,
          })),
        ),
      );
      await sendAction(fd);
      setDraft("");
      setPending([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  // Group messages by author within a 5-minute window.
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
      if (sameAuthor && within && last) last.items.push(m);
      else out.push({ authorId: m.user_id, first: m, items: [m] });
    }
    return out;
  }, [messages]);

  // Title + subtitle for the header.
  const otherMember =
    conversation.kind === "dm"
      ? conversationMemberIds
          .filter((id) => id !== currentUserId)
          .map((id) => memberById.get(id))[0]
      : undefined;

  const headerTitle =
    conversation.kind === "dm"
      ? displayName(otherMember)
      : conversation.name ?? "Chat";
  const headerKindLabel =
    conversation.kind === "channel"
      ? `# Channel${conversation.is_default ? " · default" : ""}`
      : conversation.kind === "group"
        ? "Private group"
        : "Direct message";

  const canLeave = conversation.kind !== "channel";

  return (
    <div className="card flex flex-col h-[72vh] min-h-[520px] overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-3 border-b border-forest-100 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
            {headerKindLabel}
          </div>
          <div className="display text-lg text-forest-900 truncate">
            {conversation.kind === "channel" ? `#${headerTitle}` : headerTitle}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMembers((v) => !v)}
            className="text-xs text-ink-soft hover:text-forest-900 inline-flex items-center gap-1.5"
            aria-pressed={showMembers}
          >
            <span className="font-medium">
              {visibleMemberIds.length}
            </span>
            <span>{visibleMemberIds.length === 1 ? "member" : "members"}</span>
          </button>
          {canLeave ? (
            <form action={leaveAction}>
              <input
                type="hidden"
                name="conversation_id"
                value={conversation.id}
              />
              <button
                type="submit"
                className="text-xs text-ink-muted hover:text-red-700"
                title="Leave"
              >
                Leave
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Messages */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto px-4 sm:px-5 py-4"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="h-full grid place-items-center text-center px-6">
                <div>
                  <div className="display text-xl text-forest-900">
                    Start the conversation.
                  </div>
                  <p className="mt-2 text-sm text-ink-soft max-w-sm">
                    {conversation.kind === "dm"
                      ? "Say hello, share a file, or kick things off with a quick question."
                      : "Drop the first message - everyone here will see it."}
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
                      <Monogram
                        userId={g.authorId}
                        member={author}
                        size={36}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span
                            className={
                              "text-sm font-medium " +
                              (isMe ? "text-forest-900" : "text-forest-800")
                            }
                          >
                            {displayName(author)}
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
                        <div className="mt-1 grid gap-2">
                          {g.items.map((m) => (
                            <div
                              key={m.id}
                              className="group flex items-start gap-2"
                            >
                              <div className="flex-1 min-w-0">
                                {m.body ? (
                                  <p className="text-sm text-ink whitespace-pre-wrap break-words leading-relaxed">
                                    {m.body}
                                  </p>
                                ) : null}
                                {m.attachments.length > 0 ? (
                                  <div className="mt-1.5 grid gap-1.5">
                                    {m.attachments.map((a) => (
                                      <AttachmentTile key={a.id} a={a} />
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              {(isMe || isManager) ? (
                                <form action={deleteAction}>
                                  <input
                                    type="hidden"
                                    name="conversation_id"
                                    value={conversation.id}
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
            className="border-t border-forest-100 px-3 sm:px-5 py-3"
          >
            {pending.length > 0 ? (
              <div className="mb-2 grid gap-1.5">
                {pending.map((p, i) => (
                  <div
                    key={p.storage_path}
                    className="flex items-center gap-2 rounded-lg border border-forest-100 bg-cream/40 px-2.5 py-1.5 text-xs"
                  >
                    <AttachmentIcon mime={p.mime_type} />
                    <span className="min-w-0 flex-1 truncate text-forest-900">
                      {p.file_name}
                    </span>
                    <span className="text-ink-muted shrink-0">
                      {formatBytes(p.size_bytes)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePending(i)}
                      className="text-ink-muted hover:text-red-700"
                      aria-label={`Remove ${p.file_name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach files"
                className="size-11 grid place-items-center rounded-lg text-ink-soft hover:bg-cream/70 hover:text-forest-900"
              >
                <svg
                  viewBox="0 0 20 20"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 6 L7.5 12.5 a2.5 2.5 0 0 0 3.5 3.5 L17 10 a4 4 0 0 0 -5.7 -5.7 L4.5 11" />
                </svg>
              </button>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={1}
                placeholder={
                  conversation.kind === "dm"
                    ? `Message ${headerTitle}`
                    : `Message ${conversation.kind === "channel" ? "#" : ""}${headerTitle}`
                }
                className="input resize-none py-2 leading-relaxed flex-1"
                style={{ minHeight: "2.75rem", maxHeight: "10rem" }}
              />
              <button
                type="submit"
                disabled={busy || (!draft.trim() && pending.length === 0)}
                className="btn-primary"
              >
                {busy ? "Sending..." : "Send"}
              </button>
            </div>
            {error ? (
              <p className="mt-2 text-xs text-red-700">{error}</p>
            ) : (
              <p className="mt-2 text-[11px] text-ink-muted">
                Enter to send, Shift+Enter for a new line. Attach up to 10
                files (25 MB each).
              </p>
            )}
          </form>
        </div>

        {/* Member rail (collapsible). Hidden on small screens unless toggled. */}
        {showMembers ? (
          <aside className="w-56 shrink-0 border-l border-forest-100 overflow-y-auto no-scrollbar p-3 hidden md:block">
            <MemberList
              memberIds={visibleMemberIds}
              memberById={memberById}
              currentUserId={currentUserId}
              isManager={isManager}
              kind={conversation.kind}
              conversationId={conversation.id}
              companyMembers={companyMembers}
              conversationMemberIds={conversationMemberIds}
              addAction={addGroupMemberAction}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

// =============================================================================
// Member list (right rail)
// =============================================================================
function MemberList({
  memberIds,
  memberById,
  currentUserId,
  kind,
  conversationId,
  companyMembers,
  conversationMemberIds,
  addAction,
}: {
  memberIds: string[];
  memberById: Map<string, CompanyMember>;
  currentUserId: string;
  isManager: boolean;
  kind: ConversationKind;
  conversationId: string;
  companyMembers: CompanyMember[];
  conversationMemberIds: string[];
  addAction: (formData: FormData) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      companyMembers.filter(
        (m) =>
          m.user_id !== currentUserId &&
          !conversationMemberIds.includes(m.user_id),
      ),
    [companyMembers, conversationMemberIds, currentUserId],
  );

  async function add(userId: string) {
    setAdding(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("conversation_id", conversationId);
      fd.set("user_id", userId);
      await addAction(fd);
      setPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.22em] text-gold-700 font-medium px-1">
        Members
      </div>
      <ul className="mt-2 grid gap-1">
        {memberIds.map((id) => {
          const m = memberById.get(id);
          if (!m) return null;
          return (
            <li
              key={id}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-cream/60"
            >
              <Monogram userId={id} member={m} size={26} />
              <span className="truncate flex-1">
                {displayName(m)}
                {id === currentUserId ? (
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-gold-700">
                    you
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {kind === "group" ? (
        <div className="mt-3">
          {pickerOpen ? (
            <div className="grid gap-1.5">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold-700 font-medium px-1">
                Add a teammate
              </div>
              {candidates.length === 0 ? (
                <p className="text-xs text-ink-muted px-1">
                  Everyone is already here.
                </p>
              ) : (
                <ul className="grid gap-0.5 max-h-64 overflow-y-auto no-scrollbar">
                  {candidates.map((m) => (
                    <li key={m.user_id}>
                      <button
                        type="button"
                        disabled={adding}
                        onClick={() => add(m.user_id)}
                        className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-cream/60 disabled:opacity-50 text-left"
                      >
                        <Monogram userId={m.user_id} member={m} size={20} />
                        <span className="truncate flex-1 text-forest-900">
                          {displayName(m)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-[11px] text-ink-muted hover:text-forest-900 px-1 self-start"
              >
                Cancel
              </button>
              {error ? (
                <p className="text-[11px] text-red-700 px-1">{error}</p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="text-xs text-forest-700 hover:text-forest-900 px-1"
            >
              + Add member
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// Attachment rendering
// =============================================================================
function AttachmentTile({ a }: { a: ChatAttachment }) {
  const isImage = IMAGE_TYPES.has(a.mime_type);
  if (!a.signed_url) {
    return (
      <div className="rounded-lg border border-forest-100 bg-cream/40 px-3 py-2 text-xs text-ink-muted inline-flex items-center gap-2">
        <AttachmentIcon mime={a.mime_type} />
        <span>{a.file_name}</span>
        <span>(link expired, refresh)</span>
      </div>
    );
  }
  if (isImage) {
    return (
      <a
        href={a.signed_url}
        target="_blank"
        rel="noreferrer"
        className="inline-block max-w-xs rounded-xl overflow-hidden border border-forest-100 bg-cream/40"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={a.signed_url}
          alt={a.file_name}
          className="block max-w-full max-h-72 object-contain"
        />
      </a>
    );
  }
  return (
    <a
      href={a.signed_url}
      target="_blank"
      rel="noreferrer"
      download={a.file_name}
      className="inline-flex items-center gap-2.5 rounded-lg border border-forest-100 bg-cream/40 px-3 py-2 text-sm hover:bg-cream"
    >
      <AttachmentIcon mime={a.mime_type} />
      <div className="grid">
        <span className="font-medium text-forest-900 truncate max-w-[260px]">
          {a.file_name}
        </span>
        <span className="text-[11px] text-ink-muted">
          {formatBytes(a.size_bytes)}
          <span className="ml-1.5">{prettyMime(a.mime_type)}</span>
        </span>
      </div>
    </a>
  );
}

function AttachmentIcon({ mime }: { mime: string }) {
  // Single forest-colored line icon. Specific glyphs for the obvious
  // categories; default is a generic page icon. Keeps the tile clean.
  if (mime.startsWith("image/")) {
    return (
      <Icon>
        <rect x="3" y="3" width="14" height="14" rx="2" />
        <circle cx="8" cy="8" r="1.6" />
        <path d="M3 14 L7 10 L11 13 L14 11 L17 14" />
      </Icon>
    );
  }
  if (mime.startsWith("video/")) {
    return (
      <Icon>
        <rect x="3" y="4" width="11" height="12" rx="1.5" />
        <path d="M14 8 L17 6 L17 14 L14 12 Z" />
      </Icon>
    );
  }
  if (mime.startsWith("audio/")) {
    return (
      <Icon>
        <path d="M5 12 V6 L13 4 V14" />
        <circle cx="5" cy="13" r="2" />
        <circle cx="13" cy="14" r="2" />
      </Icon>
    );
  }
  if (mime.includes("pdf")) {
    return (
      <Icon>
        <path d="M5 3 H12 L16 7 V17 H5 Z" />
        <path d="M12 3 V7 H16" />
        <text x="7" y="14" fontSize="5" fill="currentColor" stroke="none">
          PDF
        </text>
      </Icon>
    );
  }
  return (
    <Icon>
      <path d="M5 3 H12 L16 7 V17 H5 Z" />
      <path d="M12 3 V7 H16" />
    </Icon>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-forest-700 shrink-0"
    >
      {children}
    </svg>
  );
}

// =============================================================================
// Helpers
// =============================================================================
type UploadedFile = {
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  signed_url: string | null;
};

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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function prettyMime(m: string): string {
  if (m === "application/pdf") return "PDF";
  if (m.startsWith("image/")) return m.slice(6).toUpperCase();
  if (m.startsWith("video/")) return m.slice(6).toUpperCase();
  if (m.startsWith("audio/")) return m.slice(6).toUpperCase();
  if (m.includes("word")) return "Word";
  if (m.includes("sheet") || m.includes("excel")) return "Spreadsheet";
  return m.split("/").pop()?.toUpperCase() ?? "File";
}
