"use client";

import { useEffect, useRef, useState, useTransition } from "react";

type Props = {
  submitAction: (formData: FormData) => Promise<void>;
};

const KINDS = [
  { value: "idea", label: "Idea" },
  { value: "bug", label: "Bug" },
  { value: "crash", label: "Crash report" },
  { value: "praise", label: "Praise" },
  { value: "other", label: "Something else" },
] as const;

/**
 * Small "Feedback" button anchored to the lower-right of the screen, just
 * above the Bella FAB. Click to open a dialog with kind + subject + body.
 */
export function FeedbackButton({ submitAction }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
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
          setOpen(false);
          setDone(false);
        }, 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        className="fixed z-30 right-4 sm:right-6 size-11 sm:size-12 rounded-full grid place-items-center bg-forest-800 hover:bg-forest-700 text-cream shadow-lg shadow-forest-900/25 transition-colors"
        style={{
          bottom:
            "calc(5rem + env(safe-area-inset-bottom, 0px))",
        }}
        title="Send feedback"
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
          <path d="M3 4 L17 4 L17 14 L11 14 L7 17 L7 14 L3 14 Z" />
          <path d="M7 8 L13 8" />
          <path d="M7 11 L11 11" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-end sm:place-items-center px-3 pb-3 sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-forest-900/40 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative card p-6 max-w-md w-full"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute top-3 right-3 size-8 rounded-full grid place-items-center text-ink-soft hover:bg-cream hover:text-forest-900"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
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
      ) : null}
    </>
  );
}
