"use client";

import { useEffect, useRef, useState } from "react";

type Citation = {
  document_id: string;
  document_title: string;
  source_url: string | null;
  chunk_index: number;
  snippet: string;
};

type Message =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; citations: Citation[] };

export function BellaChat({
  companyPublicId,
  compact = false,
}: {
  companyPublicId?: string;
  compact?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paywall, setPaywall] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, pending]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || pending) return;
    setError(null);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setPending(true);

    try {
      const res = await fetch("/api/bella", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: trimmed,
          company_public_id: companyPublicId,
        }),
      });
      const data = await res.json();
      if (res.status === 402 && data.code === "paywall") {
        setPaywall(true);
        setError(data.error ?? "Out of free questions this month.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Bella could not answer");
      setConversationId(data.conversation_id);
      const reply: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.message ?? "",
        citations: data.citations ?? [],
      };
      setMessages((m) => [...m, reply]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={(compact ? "" : "mt-6 ") + "flex-1 flex flex-col min-h-0"}>
      <div
        ref={scrollRef}
        className={
          compact
            ? "flex-1 overflow-y-auto"
            : "card flex-1 p-5 overflow-y-auto min-h-[320px] max-h-[60vh]"
        }
      >
        {messages.length === 0 ? (
          <Suggestions onPick={(s) => setInput(s)} />
        ) : (
          <ul className="grid gap-4">
            {messages.map((m) => (
              <li key={m.id}>
                {m.role === "user" ? (
                  <UserBubble>{m.content}</UserBubble>
                ) : (
                  <AssistantBubble
                    content={m.content}
                    citations={m.citations}
                  />
                )}
              </li>
            ))}
            {pending ? (
              <li>
                <AssistantBubble content="..." citations={[]} pending />
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {paywall ? (
        <div className="mt-4 card p-5 border-gold-300/60">
          <div className="display text-base text-forest-900">
            You&apos;ve used all your free Bella questions this month.
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            Upgrade to Pro for unlimited questions plus everything else.
          </p>
          <a href="/billing" className="btn-primary mt-3 inline-flex">
            See Pro plans
          </a>
        </div>
      ) : error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : null}

      <form onSubmit={send} className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Bella anything about taxes..."
          className="input flex-1"
          autoFocus
          disabled={pending}
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={pending || !input.trim()}
        >
          {pending ? "..." : "Ask"}
        </button>
      </form>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-forest-800 text-cream px-4 py-3 text-sm leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  citations,
  pending = false,
}: {
  content: string;
  citations: Citation[];
  pending?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
        Bella
      </div>
      <div
        className={
          "rounded-2xl border border-forest-100 bg-white px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-forest-900 " +
          (pending ? "opacity-60" : "")
        }
      >
        {content}
      </div>
      {citations.length > 0 ? (
        <ol className="text-xs text-ink-muted grid gap-1.5 mt-1 pl-1">
          {citations.map((c, i) => (
            <li key={c.document_id + ":" + c.chunk_index} className="leading-relaxed">
              <span className="font-medium text-forest-800 mr-1">[{i + 1}]</span>
              {c.source_url ? (
                <a
                  href={c.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-forest-700 hover:underline"
                >
                  {c.document_title}
                </a>
              ) : (
                <span className="text-forest-700">{c.document_title}</span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Suggestions({ onPick }: { onPick: (q: string) => void }) {
  const STARTERS = [
    "What deductions am I missing as a sole proprietor?",
    "Standard mileage vs actual expenses for my vehicle?",
    "How do quarterly estimated taxes work?",
    "Can I deduct my home office?",
    "Should I consider an S-Corp election?",
  ];
  return (
    <div className="grid gap-2">
      <div className="text-sm text-ink-soft">Try one of these:</div>
      <div className="flex flex-wrap gap-2">
        {STARTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="text-xs rounded-full border border-forest-200 bg-white/60 px-3 py-1.5 hover:border-gold-300 hover:bg-cream transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
