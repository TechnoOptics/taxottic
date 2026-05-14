import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { scheduleMeeting, cancelMeeting } from "./actions";

type Params = Promise<{ engagementId: string }>;

const KIND_LABEL: Record<string, string> = {
  intro: "Intro",
  planning: "Planning",
  review: "Review",
  signing: "Signing",
  training: "Training",
  other: "Other",
};

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rescheduled: "bg-gold-50 text-gold-800 border-gold-200",
  completed: "bg-cream-100 text-ink-muted border-forest-100",
  cancelled: "bg-cream-100 text-ink-muted border-forest-100",
  no_show: "bg-amber-50 text-amber-800 border-amber-200",
};

export default async function MeetingsPage({
  params,
}: {
  params: Params;
}) {
  const { engagementId } = await params;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, tax_year, kind, company:companies!inner(id, name, public_id)")
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) notFound();
  const company = (eng as unknown as { company: { id: string; name: string; public_id: string } }).company;

  const { data: meetings } = await admin
    .from("firm_meetings")
    .select(
      "id, kind, status, starts_at, duration_minutes, provider, meeting_url, agenda, client_email, client_name, created_at, cancelled_at",
    )
    .eq("firm_id", ctx.firm.id)
    .eq("engagement_id", engagementId)
    .order("starts_at", { ascending: false })
    .limit(50);

  const { data: integrations } = await admin
    .from("firm_calendar_integrations")
    .select("provider, provider_account_email")
    .eq("user_id", user.id);
  const connectedProviders = new Set(
    (integrations ?? []).map((i) => i.provider as string),
  );

  // Sensible default: 1 week from now, rounded to the next hour.
  const defaultStart = new Date(Date.now() + 7 * 86_400_000);
  defaultStart.setMinutes(0, 0, 0);
  defaultStart.setHours(defaultStart.getHours() + 1);
  const defaultStartIso = defaultStart.toISOString().slice(0, 16);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          ·{" "}
          <Link
            href={`/firm/clients/${engagementId}`}
            className="underline decoration-dotted hover:text-forest-900"
          >
            {company.name}
          </Link>{" "}
          · Meetings
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Schedule a call.
        </h1>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_22rem]">
          {/* Meeting list */}
          <section>
            <h2 className="display text-xl text-forest-900">Upcoming & past</h2>
            {(meetings ?? []).length === 0 ? (
              <div className="mt-3 card p-6 text-center">
                <p className="text-sm text-ink-soft">
                  No meetings yet. Use the form on the right to
                  schedule one.
                </p>
              </div>
            ) : (
              <ul className="mt-3 grid gap-3">
                {(meetings ?? []).map((m) => (
                  <li key={m.id} className="card p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="display text-base text-forest-900">
                            {KIND_LABEL[m.kind] ?? m.kind}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border ${
                              STATUS_TONE[m.status] ??
                              "bg-cream-100 text-ink-muted border-forest-100"
                            }`}
                          >
                            {m.status.replace("_", " ")}
                          </span>
                          {m.provider ? (
                            <span className="text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                              via {m.provider}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          {formatMeetingTime(m.starts_at, m.duration_minutes)}
                          {m.client_email
                            ? ` · ${m.client_name || m.client_email}`
                            : ""}
                        </div>
                        {m.agenda ? (
                          <p className="mt-2 text-xs text-ink-soft whitespace-pre-wrap leading-relaxed">
                            {m.agenda}
                          </p>
                        ) : null}
                        {m.meeting_url ? (
                          <a
                            href={m.meeting_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs underline text-forest-700 hover:text-forest-900"
                          >
                            Join link →
                          </a>
                        ) : null}
                      </div>
                      {m.status === "scheduled" ? (
                        <form action={cancelMeeting}>
                          <input type="hidden" name="id" value={m.id} />
                          <input
                            type="hidden"
                            name="engagement_id"
                            value={engagementId}
                          />
                          <button className="btn-ghost text-xs px-3 h-9 hover:text-red-700">
                            Cancel
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Schedule form */}
          <aside>
            <form action={scheduleMeeting} className="card p-5 grid gap-3">
              <h2 className="display text-base text-forest-900">
                Schedule
              </h2>
              <input
                type="hidden"
                name="engagement_id"
                value={engagementId}
              />

              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Type
                </span>
                <select
                  name="kind"
                  className="input text-sm"
                  defaultValue="planning"
                >
                  {Object.entries(KIND_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Start (UTC)
                </span>
                <input
                  type="datetime-local"
                  name="starts_at"
                  required
                  defaultValue={defaultStartIso}
                  className="input text-sm tabular-nums"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Duration (min)
                </span>
                <input
                  type="number"
                  name="duration_minutes"
                  min={15}
                  max={480}
                  defaultValue={30}
                  className="input text-sm tabular-nums"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Provider
                </span>
                <select
                  name="provider"
                  className="input text-sm"
                  defaultValue="manual"
                >
                  <option value="manual">Manual (paste link)</option>
                  <option value="zoom" disabled={!connectedProviders.has("zoom")}>
                    Zoom{connectedProviders.has("zoom") ? "" : " (not connected)"}
                  </option>
                  <option
                    value="google"
                    disabled={!connectedProviders.has("google")}
                  >
                    Google Meet{connectedProviders.has("google") ? "" : " (not connected)"}
                  </option>
                  <option
                    value="microsoft"
                    disabled={!connectedProviders.has("microsoft")}
                  >
                    Microsoft Teams{connectedProviders.has("microsoft") ? "" : " (not connected)"}
                  </option>
                </select>
                <p className="text-[10px] text-ink-muted leading-relaxed">
                  Connect a calendar from{" "}
                  <Link
                    href="/firm/settings/calendar"
                    className="underline hover:text-forest-800"
                  >
                    Calendar settings
                  </Link>{" "}
                  to auto-mint join URLs.
                </p>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Meeting URL (manual)
                </span>
                <input
                  type="url"
                  name="meeting_url"
                  placeholder="https://zoom.us/j/…"
                  className="input text-sm"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Client email
                </span>
                <input
                  type="email"
                  name="client_email"
                  placeholder="client@maple.com"
                  className="input text-sm"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Agenda (optional)
                </span>
                <textarea
                  name="agenda"
                  rows={3}
                  placeholder="Review Q3 books + confirm S-Corp election."
                  className="input text-sm"
                />
              </label>

              <button type="submit" className="btn-primary text-sm mt-1">
                Schedule meeting
              </button>
            </form>
          </aside>
        </div>
      </section>
    </main>
  );
}

function formatMeetingTime(iso: string, mins: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + mins * 60_000);
  const fmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${fmt.format(start)} – ${end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
