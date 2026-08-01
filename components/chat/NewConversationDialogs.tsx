"use client";

import { useEffect, useMemo, useState } from "react";
import { rethrowIfRedirect } from "@/lib/next/redirect-error";
import { Monogram, displayName } from "./Monogram";
import type { CompanyMember } from "./types";

/**
 * The two ways a conversation starts: pick a person, or name a group
 * and pick several. Lifted out of ConversationSidebar so the chat
 * inbox and the in-conversation sidebar open the same dialogs instead
 * of each growing their own.
 *
 * Every row here is at least 44px tall because this ships inside the
 * iOS and Android WebViews.
 */

// =============================================================================
// New DM
// =============================================================================
export function NewDmDialog({
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
      // The action redirects into the conversation on success.
    } catch (err) {
      rethrowIfRedirect(err);
      setError(err instanceof Error ? err.message : "Failed to start chat.");
      setSubmitting(false);
    }
  }

  return (
    <DialogShell onClose={onClose} title="New message">
      {companyMembers.length === 0 ? (
        <EmptyTeam />
      ) : (
        <div className="grid gap-3 mt-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input min-h-11"
            placeholder="Search by name or email"
            aria-label="Search teammates"
            autoFocus
          />
          <ul className="grid gap-1 max-h-72 overflow-y-auto no-scrollbar pr-1">
            {filtered.map((m) => (
              <li key={m.user_id}>
                <button
                  type="button"
                  onClick={() => start(m.user_id)}
                  disabled={submitting}
                  className="w-full min-h-11 flex items-center gap-3 rounded-lg border border-forest-100 hover:border-forest-300 px-3 py-2 text-sm text-left disabled:opacity-50"
                >
                  <Monogram userId={m.user_id} member={m} size={32} />
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
      )}
    </DialogShell>
  );
}

// =============================================================================
// New group
// =============================================================================
export function NewGroupDialog({
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
      // The action redirects into the new group on success.
    } catch (err) {
      // Don't flash the redirect control-flow error as a red "Failed
      // to create group." toast; the action just succeeded.
      rethrowIfRedirect(err);
      setError(err instanceof Error ? err.message : "Failed to create group.");
      setSubmitting(false);
    }
  }

  return (
    <DialogShell onClose={onClose} title="New group">
      {companyMembers.length === 0 ? (
        <EmptyTeam />
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4 mt-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-forest-800">
              Group name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input min-h-11"
              placeholder="e.g. Payroll"
              maxLength={80}
              autoFocus
            />
          </label>
          <div>
            <span className="text-sm font-medium text-forest-800">
              Add members
            </span>
            <p className="text-xs text-ink-muted mt-0.5">
              You&apos;re added automatically. Pick anyone else from your team.
            </p>
            <ul className="mt-2 grid gap-1 max-h-64 overflow-y-auto no-scrollbar pr-1">
              {companyMembers.map((m) => {
                const checked = selected.has(m.user_id);
                return (
                  <li key={m.user_id}>
                    <label
                      className={
                        "min-h-11 flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer text-sm " +
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
                      <Monogram userId={m.user_id} member={m} size={32} />
                      <span className="flex-1 truncate">{displayName(m)}</span>
                      {checked ? <CheckIcon /> : null}
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
              className="btn-ghost min-h-11"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary min-h-11"
              disabled={submitting}
            >
              {submitting ? "Creating..." : "Create group"}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

// =============================================================================
// Shared pieces
// =============================================================================
function EmptyTeam() {
  return (
    <p className="mt-4 text-sm text-ink-soft">
      There is nobody else on this company yet. Add a teammate under Team and
      they will show up here.
    </p>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M3 8.5 L6.5 12 L13 4.5" />
    </svg>
  );
}

/** Generic dialog shell. No overlay library, to keep the bundle small. */
export function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        className="card relative w-full max-w-md p-5 sm:p-7 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 right-2 size-11 rounded-full grid place-items-center text-ink-muted hover:bg-cream"
        >
          <svg
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 3 L13 13 M13 3 L3 13" />
          </svg>
        </button>
        <h2 className="display text-2xl text-forest-900 pr-12">{title}</h2>
        {children}
      </div>
    </div>
  );
}
