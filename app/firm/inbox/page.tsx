import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { markActivityRead } from "@/lib/firm/notifications";
import { ActivityList, type ActivityRow } from "@/components/firm/ActivityList";

// Force dynamic so the read-cursor update happens on every visit.
export const dynamic = "force-dynamic";

// /firm/inbox — unified activity feed for the current firm.
//
// On render we mark the user's read cursor to now() so the header
// unread badge clears immediately. The ActivityList client component
// subscribes to Supabase Realtime so new events appear without a
// refresh. Server fetches the initial 50 rows; Realtime keeps the
// feed live from there.

const LIMIT = 50;

export default async function FirmInboxPage() {
  const { supabase, admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  // Mark inbox read first so subsequent unread-count queries on the
  // same render cycle reflect "just opened."
  await markActivityRead(supabase, ctx.firm.id);

  const { data: activity } = await admin
    .from("firm_activity_log")
    .select("id, kind, summary, created_at, actor_side, company_id, engagement_id")
    .eq("firm_id", ctx.firm.id)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              <Link
                href="/firm"
                className="underline decoration-dotted hover:text-forest-900"
              >
                Firm cockpit
              </Link>{" "}
              · Inbox
            </div>
            <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
              Everything that happened.
            </h1>
            <p className="mt-2 text-sm text-ink-soft max-w-2xl">
              Live feed of events from your clients, engagements,
              documents, and payments. Marked read when you open this
              page; the header badge re-fills as new activity comes in.
            </p>
          </div>
          <Link
            href="/firm/settings/notifications"
            className="btn-ghost text-sm"
          >
            Notification settings
          </Link>
        </div>

        <section className="mt-8 card p-5">
          <ActivityList
            firmId={ctx.firm.id}
            initialRows={(activity ?? []) as ActivityRow[]}
            limit={LIMIT}
          />
        </section>

        <p className="mt-6 text-[11px] text-ink-muted leading-relaxed max-w-2xl">
          Showing the most recent {LIMIT} events. Older events stay
          in the database but don&apos;t render here — they surface in
          the per-client page&apos;s activity panel when you drill into
          an engagement.
        </p>
      </section>
    </main>
  );
}
