import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { createThread } from "./actions";

export const dynamic = "force-dynamic";

export default async function FirmThreadsPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: threads } = await admin
    .from("firm_threads")
    .select(
      "id, title, engagement_id, created_by, last_message_at, created_at",
    )
    .eq("firm_id", ctx.firm.id)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false })
    .limit(50);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Team chat
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Internal threads.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          Slack-style threads scoped to your firm. Use them for
          engagement reviews, year-end planning, or just &quot;who has
          the Smith K-1?&quot; coordination.
        </p>

        <form
          action={createThread}
          className="card p-4 mt-6 grid sm:grid-cols-[1fr_auto] gap-2 items-end"
        >
          <label className="grid gap-1">
            <span className="text-xs font-medium text-forest-800">
              New thread title
            </span>
            <input
              type="text"
              name="title"
              required
              maxLength={200}
              placeholder="Q4 prep — Smith Allen partners"
              className="input text-sm"
            />
          </label>
          <button type="submit" className="btn-primary text-sm">
            Start thread
          </button>
        </form>

        <section className="mt-6">
          {(threads ?? []).length === 0 ? (
            <p className="text-sm text-ink-soft">
              No threads yet. Start one above.
            </p>
          ) : (
            <ul className="grid gap-2">
              {(threads ?? []).map((t) => (
                <li
                  key={t.id}
                  className="card card-hover p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/firm/threads/${t.id}`}
                      className="display text-base text-forest-900 hover:underline"
                    >
                      {t.title}
                    </Link>
                    <div className="text-xs text-ink-muted mt-0.5">
                      Last activity{" "}
                      {new Date(
                        t.last_message_at ?? t.created_at,
                      ).toLocaleString()}
                    </div>
                  </div>
                  <span className="text-xs text-ink-muted">→</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}
