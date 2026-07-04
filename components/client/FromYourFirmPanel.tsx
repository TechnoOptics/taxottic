import Link from "next/link";
import { formatCents } from "@/lib/tax/forecast";

// Server-rendered "From your firm" panel that lands on the client's
// preparer page below the engagement card. Surfaces three things the
// firm has sent the client through Phase 5-7:
//   - Documents awaiting signature or recently signed
//   - Upcoming meetings the firm scheduled
//   - Open invoices (sent, viewed, paid)
//
// This is the client-side complement to the firm-side document /
// meeting / invoice pages we shipped in Phases 5-7. The firm
// creates them on /firm/clients/{engagementId}/{documents,meetings,
// invoices}; the client sees them here.

export type FromYourFirmDocument = {
  id: string;
  kind: string;
  status: string;
  filename: string;
  created_at: string;
  signed_at: string | null;
};

export type FromYourFirmMeeting = {
  id: string;
  kind: string;
  starts_at: string;
  duration_minutes: number;
  status: string;
  meeting_url: string | null;
  agenda: string | null;
};

export type FromYourFirmInvoice = {
  id: string;
  invoice_number: string;
  total_cents: number;
  currency: string;
  status: string;
  due_at: string | null;
  stripe_hosted_invoice_url: string | null;
};

export function FromYourFirmPanel({
  firmName,
  firmAccentColor,
  documents,
  meetings,
  invoices,
}: {
  firmName: string;
  firmAccentColor: string | null;
  documents: FromYourFirmDocument[];
  meetings: FromYourFirmMeeting[];
  invoices: FromYourFirmInvoice[];
}) {
  const hasAny =
    documents.length > 0 || meetings.length > 0 || invoices.length > 0;
  if (!hasAny) {
    return (
      <div className="card p-5 mt-6">
        <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
          From {firmName}
        </div>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          Nothing yet. When {firmName} sends you a document, schedules
          a meeting, or issues an invoice, it&apos;ll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5 mt-6">
      <div
        className="text-[10px] uppercase tracking-[0.2em]"
        style={{ color: firmAccentColor ?? undefined }}
      >
        From {firmName}
      </div>
      <div className="mt-3 grid gap-5">
        {documents.length > 0 ? (
          <DocumentsSection documents={documents} />
        ) : null}
        {meetings.length > 0 ? <MeetingsSection meetings={meetings} /> : null}
        {invoices.length > 0 ? <InvoicesSection invoices={invoices} /> : null}
      </div>
    </div>
  );
}

function DocumentsSection({ documents }: { documents: FromYourFirmDocument[] }) {
  return (
    <section>
      <h3 className="display text-base text-forest-900">Documents</h3>
      <ul className="mt-2 grid gap-2">
        {documents.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between rounded-lg border border-forest-100 bg-white/70 px-3 py-2.5 text-sm gap-3"
          >
            <div className="min-w-0">
              <div className="font-medium text-forest-900 truncate">
                {prettyDocKind(d.kind)}
              </div>
              <div className="text-xs text-ink-muted">
                {d.filename} ·{" "}
                {d.signed_at
                  ? `Signed ${formatDate(d.signed_at)}`
                  : `Posted ${formatDate(d.created_at)}`}
              </div>
            </div>
            <span
              className={
                "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                docStatusTone(d.status)
              }
            >
              {prettyDocStatus(d.status)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MeetingsSection({ meetings }: { meetings: FromYourFirmMeeting[] }) {
  return (
    <section>
      <h3 className="display text-base text-forest-900">Upcoming meetings</h3>
      <ul className="mt-2 grid gap-2">
        {meetings.map((m) => (
          <li
            key={m.id}
            className="rounded-lg border border-forest-100 bg-white/70 px-3 py-2.5 text-sm"
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="font-medium text-forest-900">
                  {prettyMeetingKind(m.kind)}
                </div>
                <div className="text-xs text-ink-muted">
                  {formatMeetingTime(m.starts_at, m.duration_minutes)}
                </div>
              </div>
              {m.meeting_url ? (
                <a
                  href={m.meeting_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline text-forest-700 hover:text-forest-900 whitespace-nowrap"
                >
                  Join →
                </a>
              ) : null}
            </div>
            {m.agenda ? (
              <p className="mt-1 text-xs text-ink-soft leading-relaxed whitespace-pre-wrap">
                {m.agenda}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function InvoicesSection({ invoices }: { invoices: FromYourFirmInvoice[] }) {
  return (
    <section>
      <h3 className="display text-base text-forest-900">Invoices</h3>
      <ul className="mt-2 grid gap-2">
        {invoices.map((i) => (
          <li
            key={i.id}
            className="rounded-lg border border-forest-100 bg-white/70 px-3 py-2.5 text-sm flex items-center justify-between gap-3 flex-wrap"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-forest-900">
                  {i.invoice_number}
                </span>
                <span
                  className={
                    "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                    invoiceStatusTone(i.status)
                  }
                >
                  {i.status}
                </span>
                <span className="tabular-nums font-medium text-forest-900">
                  {formatCents(i.total_cents)}
                </span>
              </div>
              {i.due_at ? (
                <div className="text-xs text-ink-muted">
                  Due {formatDate(i.due_at)}
                </div>
              ) : null}
            </div>
            {i.status === "sent" || i.status === "viewed" ? (
              i.stripe_hosted_invoice_url ? (
                <Link
                  href={i.stripe_hosted_invoice_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary text-xs px-3 h-9"
                >
                  Pay
                </Link>
              ) : null
            ) : i.status === "paid" ? (
              <span className="text-xs text-emerald-700 whitespace-nowrap">
                ✓ Paid
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function prettyDocKind(k: string): string {
  return (
    {
      engagement_letter: "Engagement letter",
      organizer: "Tax organizer",
      invoice: "Invoice",
      schedule_c_draft: "Schedule C (draft)",
      k1_draft: "Schedule K-1 (draft)",
      "1099_nec_draft": "Form 1099-NEC (draft)",
      "1099_misc_draft": "Form 1099-MISC (draft)",
      "1040_draft": "Form 1040 (draft)",
      tax_return_packet: "Tax return packet",
    }[k] ?? "Document"
  );
}

function prettyDocStatus(s: string): string {
  return (
    {
      draft: "Draft",
      ready_for_review: "Ready",
      awaiting_signature: "Sign needed",
      signed: "Signed",
      filed: "Filed",
      sent_to_client: "Available",
    }[s] ?? s
  );
}

function docStatusTone(s: string): string {
  switch (s) {
    case "signed":
    case "filed":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "awaiting_signature":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "ready_for_review":
    case "sent_to_client":
      return "bg-gold-50 text-gold-800 border-gold-200";
    default:
      return "bg-cream-100 text-ink-muted border-forest-100";
  }
}

function prettyMeetingKind(k: string): string {
  return (
    {
      intro: "Intro call",
      planning: "Planning",
      review: "Review",
      signing: "Signing",
      training: "Training",
      other: "Meeting",
    }[k] ?? "Meeting"
  );
}

function invoiceStatusTone(s: string): string {
  switch (s) {
    case "paid":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "sent":
    case "viewed":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "voided":
    case "refunded":
      return "bg-cream-100 text-ink-muted border-forest-100";
    case "failed":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-cream-100 text-ink-muted border-forest-100";
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function formatMeetingTime(iso: string, minutes: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + minutes * 60_000);
  return `${new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(start)}, ${end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
