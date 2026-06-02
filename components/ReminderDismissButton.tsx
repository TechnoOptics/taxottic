"use client";

import { useTransition } from "react";
import { dismissAllOverdueReminders } from "@/app/reminders/actions";

/**
 * The "X" on the dashboard's overdue-reminders recap card.
 *
 * Previously this was a bare `<form action={dismissAllOverdueReminders}>`
 * rendered directly in the dashboard Server Component. On device that
 * form submitted as a plain navigation POST to /dashboard WITHOUT the
 * Next-Action header — so the server action never ran and the card
 * never dismissed (confirmed on a Galaxy Z Fold5: dismissed_at stayed
 * null after tapping the X). Invoking the server action from a Client
 * Component via a transition dispatches it as a proper action RPC, so
 * the dismiss actually fires and the card disappears on revalidate.
 */
export function ReminderDismissButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Dismiss overdue reminders"
      title="Dismiss — you can still open them from /reminders"
      onClick={() => {
        startTransition(() => {
          void dismissAllOverdueReminders();
        });
      }}
      className="rounded-full p-1 text-ink-muted hover:bg-cream-200 hover:text-forest-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 disabled:opacity-50 dark:hover:bg-forest-800"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M3 3 L11 11 M11 3 L3 11" />
      </svg>
    </button>
  );
}
