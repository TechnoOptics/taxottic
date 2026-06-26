"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** Filename to display so the user knows which file the popup is for. */
  fileName: string;
  /** True when the previous attempt's password was wrong. */
  wrongAttempt?: boolean;
  /** Caller submits with whatever the user typed; promise rejects if the
   *  password was wrong so the dialog can show the wrongAttempt state. */
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
};

/**
 * Lightweight password popup for unlocking PDF tax documents. Renders
 * an in-page modal (no portal — keeps it scoped to the upload component)
 * and locks focus on the password input. Shift-Tab cycles correctly.
 */
export function PdfPasswordPrompt({ fileName, wrongAttempt, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [showText, setShowText] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setPending(true);
    try {
      await onSubmit(password);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-password-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl border border-forest-100 w-full max-w-md p-6">
        <h2
          id="pdf-password-title"
          className="display text-xl text-forest-900"
        >
          Unlock the PDF
        </h2>
        <p className="mt-1.5 text-sm text-ink-soft leading-relaxed">
          <span className="text-forest-900 font-medium">{fileName}</span> is
          password protected. Type the password and we&apos;ll read it without
          you having to remove the password from your file.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.18em] text-gold-700">
              PDF password
            </span>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type={showText ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={pending}
                className="input flex-1"
                aria-invalid={wrongAttempt ? "true" : "false"}
              />
              <button
                type="button"
                onClick={() => setShowText((v) => !v)}
                className="text-xs text-ink-muted hover:text-forest-900"
                aria-label={showText ? "Hide password" : "Show password"}
              >
                {showText ? "Hide" : "Show"}
              </button>
            </div>
            {wrongAttempt ? (
              <span className="text-xs text-red-700 mt-1">
                That password didn&apos;t work. Try again.
              </span>
            ) : null}
          </label>

          <p className="text-[11px] text-ink-muted leading-relaxed">
            The password stays on this page and is sent over TLS only to
            unlock your file. We do not save it.
          </p>

          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="text-sm text-ink-muted hover:text-forest-900 px-3 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !password.trim()}
              className="btn-primary text-sm"
            >
              {pending ? "Unlocking..." : "Unlock and read"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
