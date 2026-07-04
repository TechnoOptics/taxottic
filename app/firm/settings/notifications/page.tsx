import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import {
  DEFAULT_DIGEST_PREFS,
  DIGEST_INTERESTING_KINDS,
} from "@/lib/firm/notifications";
import { updateNotificationPrefs } from "./actions";

// /firm/settings/notifications, per-user digest preferences.
//
// One firm + one user = one prefs row. Defaults live in
// lib/firm/notifications.ts so the row only exists once the user
// touches it.

const KIND_LABELS: Record<string, string> = {
  "client.company_created": "Client created a new company",
  "client.income_logged": "Client logged income",
  "client.expense_logged": "Client logged an expense",
  "client.bank_connected": "Client connected a bank feed",
  "client.document_uploaded": "Client uploaded a document",
  "client.engagement_requested": "Client requested an engagement",
  "client.engagement_accepted": "Client accepted an engagement",
  "client.message_sent": "Client sent a message",
  "firm.engagement_accepted": "Firm accepted an engagement",
  "firm.engagement_completed": "Engagement marked complete",
  "firm.document_signed": "Document was signed",
  "firm.signature_requested": "Signature requested",
  "firm.meeting_scheduled": "Meeting scheduled",
  "firm.invoice_sent": "Invoice sent",
  "firm.payment_received": "Payment received",
  "firm.tax_form_drafted": "Tax form drafted",
  "firm.tax_form_filed": "Tax form filed",
};

export default async function NotificationsPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: prefs } = await admin
    .from("firm_notification_preferences")
    .select("digest_cadence, digest_hour_utc, excluded_kinds")
    .eq("user_id", user.id)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();

  const cadence =
    (prefs?.digest_cadence as "off" | "daily" | "weekly" | undefined) ??
    DEFAULT_DIGEST_PREFS.digest_cadence;
  const hour =
    typeof prefs?.digest_hour_utc === "number"
      ? prefs.digest_hour_utc
      : DEFAULT_DIGEST_PREFS.digest_hour_utc;
  const excluded = new Set<string>(
    (prefs?.excluded_kinds as string[] | undefined) ?? [],
  );

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Notification settings
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Pick your cadence.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          The inbox is always live in-app. This controls the email
          digest only, how often we send a summary of activity you
          haven&apos;t already opened in the app.
        </p>

        <form
          action={updateNotificationPrefs}
          className="card p-5 sm:p-6 mt-6 grid gap-5"
        >
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-forest-800">
              Digest cadence
            </legend>
            {(
              [
                { value: "off", label: "Off", sub: "I'll check the inbox in-app." },
                { value: "daily", label: "Daily", sub: "One summary email per day." },
                { value: "weekly", label: "Weekly", sub: "Monday morning summary." },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-3 cursor-pointer"
              >
                <input
                  type="radio"
                  name="digest_cadence"
                  value={opt.value}
                  defaultChecked={cadence === opt.value}
                  className="mt-1"
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium text-forest-900">
                    {opt.label}
                  </span>
                  <span className="text-xs text-ink-muted">{opt.sub}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="grid gap-1.5 max-w-xs">
            <span className="text-sm font-medium text-forest-800">
              Send time (UTC, 24h)
            </span>
            <input
              type="number"
              name="digest_hour_utc"
              min={0}
              max={23}
              defaultValue={hour}
              className="input tabular-nums"
            />
            <span className="text-[11px] text-ink-muted">
              13 = 9am ET / 6am PT. We&apos;ll honor your timezone
              once we capture it on the profile page.
            </span>
          </label>

          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium text-forest-800">
              Exclude these event types from the digest
            </legend>
            <p className="text-[11px] text-ink-muted leading-relaxed -mt-1 mb-1">
              Inbox always shows everything. This controls what
              lands in the email summary.
            </p>
            <div className="grid gap-1.5 max-h-72 overflow-y-auto pr-2">
              {DIGEST_INTERESTING_KINDS.map((kind) => (
                <label key={kind} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name={`exclude:${kind}`}
                    defaultChecked={excluded.has(kind)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-forest-900">
                    {KIND_LABELS[kind] ?? kind}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex items-center gap-2 pt-2">
            <button type="submit" className="btn-primary text-sm">
              Save preferences
            </button>
            <Link href="/firm/inbox" className="btn-ghost text-sm">
              ← Back to inbox
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
