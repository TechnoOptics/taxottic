"use client";

import { useState } from "react";

/**
 * Read-only invite link with a copy button. The URL itself contains the
 * one-shot token, so we never want this to be selectable forever in the
 * page (there's a one-time card on /manage that displays it). The
 * clipboard fallback uses the modern API with a textarea fallback for
 * older browsers.
 */
export function CopyInviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Older browsers / no permission: fall back to the deprecated
      // execCommand path so something still works.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "true");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div className="mt-4 grid gap-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="input flex-1 font-mono text-xs"
        />
        <button
          type="button"
          onClick={copy}
          className="btn-primary sm:w-32"
          aria-label="Copy invite link"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        Treat this like a password: anyone with the link can join the team
        as the invited email.
      </p>
    </div>
  );
}
