"use client";

import { useState, useTransition } from "react";

type Props = {
  acceptAction: () => Promise<void>;
};

/**
 * Slim cookie-style consent banner. Renders only when the user's profile has
 * not yet recorded a gdpr_consented_at timestamp. Single primary action:
 * Accept. Linked to the privacy policy and terms.
 */
export function GdprBanner({ acceptAction }: Props) {
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  return (
    <div
      role="region"
      aria-label="Privacy and data consent"
      className="fixed left-1/2 -translate-x-1/2 z-40 px-4 max-w-2xl w-full"
      style={{
        bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="card flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 shadow-2xl shadow-forest-900/30 border-gold-300/60">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-forest-900">
            Your data, your terms.
          </div>
          <div className="text-xs text-ink-soft mt-0.5 leading-relaxed">
            Taxottic stores your tax data on encrypted servers in the US,
            never sells it, and exports or deletes it on request. By
            continuing you accept our{" "}
            <a
              href="/legal/privacy"
              className="underline hover:text-forest-900"
              target="_blank"
              rel="noopener noreferrer"
            >
              privacy policy
            </a>{" "}
            and{" "}
            <a
              href="/legal/terms"
              className="underline hover:text-forest-900"
              target="_blank"
              rel="noopener noreferrer"
            >
              terms
            </a>
            .
          </div>
        </div>
        <button
          type="button"
          className="btn-primary text-sm h-10 px-5 sm:self-auto"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await acceptAction();
              setHidden(true);
            });
          }}
        >
          {pending ? "..." : "Accept"}
        </button>
      </div>
    </div>
  );
}
