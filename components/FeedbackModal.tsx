"use client";

import { useEffect, useRef, useState, useTransition } from "react";

const KINDS = [
  { value: "idea", label: "Idea" },
  { value: "bug", label: "Bug" },
  { value: "crash", label: "Crash report" },
  { value: "praise", label: "Praise" },
  { value: "other", label: "Something else" },
] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  submitAction: (formData: FormData) => Promise<void>;
};

/**
 * Feedback modal — kind / subject / body form that POSTs to the
 * submitFeedback server action.
 *
 * Previously this lived inside FeedbackButton.tsx and the trigger
 * (a floating FAB above the Bella button) was bundled in. The FAB
 * was removed per product feedback ("too cluttered, two bubbles
 * stacked"); the modal logic was extracted here so the UserMenu's
 * "Send feedback" item can open the same flow without rebuilding it.
 *
 * Renders a hidden div when `open` is false to keep React state
 * stable. The form auto-resets after a successful submission, and
 * the modal closes itself after a short success state so the user
 * sees the "Sent" confirmation before it disappears.
 */
export function FeedbackModal({ open, onClose, submitAction }: Props) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  // Reset transient state any time the modal is closed/reopened so a
  // user who closes and re-opens doesn't see a stale "Sent ✓" badge.
  useEffect(() => {
    if (!open) {
      setDone(false);
      setError(null);
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.append("page_url", window.location.href);
    fd.append("user_agent", navigator.userAgent);
    startTransition(async () => {
      try {
        await submitAction(fd);
        setDone(true);
        formRef.current?.reset();
        setTimeout(() => {
          onClose();
          setDone(false);
        }, 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send");
      }
    });
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      // z-[60] keeps the modal above any FAB / fixed UI; the BellaFAB
      // is z-40 and the avatar dropdown is portaled at z-9999, so the
      // modal sits comfortably above either when open.
      className="fixed inset-0 z-[60] grid place-items-end sm:place-items-center px-3 pb-3 sm:p-6"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-forest-900/40 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative card p-6 max-w-md w-full"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 size-8 rounded-full grid place-items-center text-ink-soft hover:bg-cream hover:text-forest-900"
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

        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Feedback
        </div>
        <h2 className="display text-2xl text-forest-900 mt-1">
          Tell us anything.
        </h2>
        <p className="text-sm text-ink-soft mt-1">
          Crash, bug, idea, or praise. We read every one.
        </p>

        <form ref={formRef} onSubmit={onSubmit} className="mt-5 grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-forest-800">
              What kind?
            </span>
            <select name="kind" className="input" defaultValue="idea">
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-forest-800">
              Subject (optional)
            </span>
            <input
              name="subject"
              className="input"
              maxLength={120}
              placeholder="One-line summary"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-forest-800">
              Details
            </span>
            <textarea
              name="body"
              required
              rows={5}
              className="input py-2"
              placeholder="What happened, what you'd like, screenshots welcome via attachments later."
              maxLength={4000}
            />
          </label>

          <div className="flex items-center gap-3 mt-1">
            <button
              type="submit"
              className="btn-primary"
              disabled={pending || done}
            >
              {done ? "Sent ✓" : pending ? "Sending..." : "Send"}
            </button>
            {error ? (
              <span className="text-xs text-red-700">{error}</span>
            ) : null}
            {done ? (
              <span className="text-xs text-emerald-800">
                Thank you. Closing in a moment.
              </span>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
