import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { ensureQuarterlyReminders } from "@/lib/reminders/seed";
import { dismissReminder, markReminderRead } from "./actions";

// Force dynamic so dismiss + mark-read actions show their effect on
// the very next render. Without this Next.js can serve a cached
// version and the dismissed item appears to linger.
export const dynamic = "force-dynamic";

export default async function RemindersPage() {
  const { supabase, admin, user } = await requireUserWithAdmin();

  // Idempotent: makes sure this year's quarterly + filing reminders exist
  // for the current user. Cheap on hot path.
  const taxYear = new Date().getUTCFullYear();
  await ensureQuarterlyReminders(admin, user.id, taxYear);

  const { data: items } = await supabase
    .from("reminders")
    .select("id, kind, title, body, due_at, read_at, dismissed_at")
    .is("dismissed_at", null)
    .order("due_at", { ascending: true });

  // Defensive dedupe on the read side. Migration
  // 20260511000002_reminders_dedupe cleaned up existing duplicates and
  // added a unique index that prevents new ones, but the index hadn't
  // been deployed when QA caught 8x duplicates on this page. Keep this
  // filter as belt-and-suspenders: even with the constraint in place,
  // an undeployed staging environment or a future schema-change window
  // could regress.
  const seenKey = new Set<string>();
  const itemsDedup = (items ?? []).filter((r) => {
    const dayKey = new Date(r.due_at).toISOString().slice(0, 10);
    const key = `${r.kind}:${dayKey}`;
    if (seenKey.has(key)) return false;
    seenKey.add(key);
    return true;
  });

  const upcoming = itemsDedup.filter(
    (r) => new Date(r.due_at).getTime() >= Date.now(),
  );
  const overdue = itemsDedup.filter(
    (r) => new Date(r.due_at).getTime() < Date.now(),
  );

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Reminders
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          What is coming up
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-lg">
          Federal tax dates and your custom reminders. Dismiss anything you
          have handled.
        </p>

        {overdue.length > 0 ? (
          <section className="mt-8">
            <h2 className="display text-xl text-red-800">Overdue</h2>
            <ul className="mt-3 grid gap-3">
              {overdue.map((r) => (
                <ReminderRow key={r.id} item={r} status="overdue" />
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-8">
          <h2 className="display text-xl text-forest-900">Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              Nothing on the horizon.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {upcoming.map((r) => (
                <ReminderRow key={r.id} item={r} status="upcoming" />
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}

function ReminderRow({
  item,
  status,
}: {
  item: {
    id: string;
    kind: string;
    title: string;
    body: string | null;
    due_at: string;
    read_at: string | null;
  };
  status: "upcoming" | "overdue";
}) {
  const due = new Date(item.due_at);
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  const dayLabel =
    status === "overdue"
      ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`
      : days === 0
        ? "today"
        : `in ${days} day${days === 1 ? "" : "s"}`;

  return (
    <li
      className={
        "card p-5 flex flex-col sm:flex-row sm:items-center gap-4 " +
        (status === "overdue" ? "border-red-200" : "")
      }
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="display text-base text-forest-900 truncate">
            {item.title}
          </span>
          <span
            className={
              "text-[10px] uppercase tracking-[0.2em] " +
              (status === "overdue" ? "text-red-700" : "text-gold-700")
            }
          >
            {dayLabel}
          </span>
        </div>
        {item.body ? (
          <p className="mt-1 text-sm text-ink-soft leading-relaxed">
            {item.body}
          </p>
        ) : null}
        <div className="mt-1 text-xs text-ink-muted">
          {due.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        {!item.read_at ? (
          <form action={markReminderRead}>
            <input type="hidden" name="id" value={item.id} />
            <button className="btn-ghost text-xs px-3 h-9">
              Mark read
            </button>
          </form>
        ) : null}
        <form action={dismissReminder}>
          <input type="hidden" name="id" value={item.id} />
          <button className="btn-ghost text-xs px-3 h-9">Dismiss</button>
        </form>
      </div>
    </li>
  );
}
