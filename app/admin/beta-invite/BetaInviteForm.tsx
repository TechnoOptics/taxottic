"use client";

import { useActionState } from "react";
import { sendBetaInviteAction, type BetaInviteState } from "./actions";

/**
 * Super-admin form to send a beta / TestFlight invite. Uses useActionState so
 * the operator gets inline success/failure feedback (including the "no email
 * provider configured" case) without a page reload.
 */
export function BetaInviteForm() {
  const [state, formAction, pending] = useActionState<BetaInviteState, FormData>(
    sendBetaInviteAction,
    null,
  );

  return (
    <form action={formAction} className="mt-6 grid gap-4 max-w-xl">
      <Field label="Recipient email" hint="Double-check the domain before sending.">
        <input
          name="to"
          type="email"
          required
          placeholder="tester@gmail.com"
          className="input"
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Recipient name (optional)">
          <input
            name="recipient_name"
            type="text"
            placeholder="Antonette"
            className="input"
          />
        </Field>
        <Field label="Your name (from-name, optional)">
          <input
            name="inviter_name"
            type="text"
            placeholder="Taxottic team"
            className="input"
          />
        </Field>
      </div>

      <Field label="Platform">
        <select name="platform" defaultValue="ios" className="input">
          <option value="ios">iOS (TestFlight)</option>
          <option value="android">Android (Google Play beta)</option>
          <option value="both">Both</option>
        </select>
      </Field>

      <Field
        label="Invite link"
        hint="The TestFlight public link (or Play opt-in URL) from the store console."
      >
        <input
          name="invite_url"
          type="url"
          required
          placeholder="https://testflight.apple.com/join/XXXXXXXX"
          className="input"
        />
      </Field>

      <Field label="Personal message (optional)">
        <textarea
          name="personal_message"
          rows={2}
          placeholder="Thanks for helping test, would love your read on the receipt scanning."
          className="input"
        />
      </Field>

      <Field
        label="Things to look at (optional)"
        hint="One per line; shown as bullets in the email."
      >
        <textarea
          name="focus_areas"
          rows={3}
          placeholder={"Personal deduction tracker\nReceipt scanning\nYear-end export"}
          className="input"
        />
      </Field>

      {state ? (
        <p
          role="status"
          className={
            "rounded-lg border px-3 py-2 text-sm " +
            (state.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800")
          }
        >
          {state.message}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Sending..." : "Send beta invite"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-forest-800">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-ink-muted">{hint}</span> : null}
    </label>
  );
}
