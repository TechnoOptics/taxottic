"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

/**
 * Top-bar smart search powered by Bella.
 *
 * The input lives in the AppHeader on every consumer page. Hitting
 * Enter (or clicking "Ask") POSTs to /api/bella with the question
 * and the optional company_public_id, then shows the answer in a
 * popover anchored to the input. Citations render below the answer
 * as small links.
 *
 * Conversation continuity: we keep the latest conversation_id in
 * component state, so a follow-up question lands in the same Bella
 * thread without the user having to retype context.
 */

type Citation = {
  document_id: string;
  document_title: string;
  source_url: string | null;
  chunk_index: number;
  snippet: string;
};

type Props = {
  /** Optional active-company id to pass through so Bella sees the
   *  forecast / business context for the right company. */
  companyPublicId?: string;
};

type Status = "idle" | "asking" | "answered" | "error";

export function SmartSearch({ companyPublicId }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [answer, setAnswer] = useState<string>("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on Escape or outside click. The input stays
  // focused so the user can re-open by typing again.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) setOpen(false);
    }
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (formRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", onKey);
      document.addEventListener("mousedown", onClick);
      return () => {
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("mousedown", onClick);
      };
    }
  }, [open]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = query.trim();
    if (!q || status === "asking") return;
    setStatus("asking");
    setErrorMsg(null);
    setOpen(true);
    try {
      const res = await fetch("/api/bella", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
          conversation_id: conversationId,
          company_public_id: companyPublicId ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        conversation_id?: string;
        citations?: Citation[];
        error?: string;
        upgrade_url?: string;
      };
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error ?? "Bella couldn't answer right now.");
        return;
      }
      setAnswer(data.message ?? "");
      setCitations(data.citations ?? []);
      if (data.conversation_id) setConversationId(data.conversation_id);
      setStatus("answered");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Network error");
    }
  }

  function reset() {
    setQuery("");
    setAnswer("");
    setCitations([]);
    setErrorMsg(null);
    setStatus("idle");
    setOpen(false);
  }

  return (
    <div className="relative w-full max-w-md">
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="relative"
        role="search"
        aria-label="Ask Bella"
      >
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-forest-700"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle cx="9" cy="9" r="5" />
            <path strokeLinecap="round" d="M13 13l4 4" />
          </svg>
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (answer || errorMsg) setOpen(true);
          }}
          placeholder="Ask Bella about your business…"
          aria-label="Ask Bella about your business or taxes"
          className="w-full rounded-full border border-forest-100 bg-paper/80 backdrop-blur pl-9 pr-20 py-2 text-sm text-forest-900 placeholder:text-ink-muted focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200"
        />
        <button
          type="submit"
          disabled={!query.trim() || status === "asking"}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 rounded-full bg-forest-800 px-3 text-xs font-medium text-cream disabled:opacity-50"
        >
          {status === "asking" ? "Asking…" : "Ask"}
        </button>
      </form>

      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Bella's answer"
          className="card card-opaque !absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-y-auto !p-4"
        >
          {status === "asking" ? (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <span
                className="size-3 rounded-full border-2 border-gold-300 border-r-transparent animate-spin"
                aria-hidden="true"
              />
              Bella is thinking…
            </div>
          ) : status === "error" ? (
            <div>
              <p className="text-sm text-red-700">{errorMsg}</p>
              <button
                type="button"
                onClick={reset}
                className="mt-2 text-xs text-ink-muted hover:text-forest-900 underline underline-offset-2"
              >
                Clear
              </button>
            </div>
          ) : status === "answered" ? (
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700 font-medium">
                Bella
              </div>
              <div className="mt-2 text-sm text-forest-900 leading-relaxed whitespace-pre-wrap">
                {answer || "(no answer)"}
              </div>
              {citations.length > 0 ? (
                <div className="mt-4 border-t border-forest-100 pt-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted font-medium">
                    Sources
                  </div>
                  <ul className="mt-1.5 grid gap-1">
                    {citations.map((c, i) => (
                      <li key={`${c.document_id}-${c.chunk_index}-${i}`}>
                        {c.source_url ? (
                          <a
                            href={c.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
                          >
                            [{i + 1}] {c.document_title} ↗
                          </a>
                        ) : (
                          <span className="text-xs text-ink-muted">
                            [{i + 1}] {c.document_title}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-4 flex items-center justify-between gap-3 text-xs">
                <Link
                  href={
                    companyPublicId ? `/c/${companyPublicId}/chat` : "/bella"
                  }
                  className="text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
                  onClick={() => setOpen(false)}
                >
                  Open full chat →
                </Link>
                <button
                  type="button"
                  onClick={reset}
                  className="text-ink-muted hover:text-forest-900"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
