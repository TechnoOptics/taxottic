import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { createServiceClient } from "@/lib/supabase/server";
import { updateFeedbackStatus } from "../actions";

const KIND_LABEL: Record<string, string> = {
  crash: "Crash",
  bug: "Bug",
  idea: "Idea",
  praise: "Praise",
  other: "Other",
};

export default async function AdminFeedbackPage() {
  const { user } = await requireSuperAdmin();
  const admin = createServiceClient();

  const { data: items } = await admin
    .from("feedback")
    .select(
      "id, user_id, email, kind, subject, body, page_url, user_agent, status, admin_note, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const grouped: Record<string, typeof items> = {
    new: [],
    seen: [],
    resolved: [],
    dismissed: [],
  };
  for (const i of items ?? []) {
    (grouped[i.status] ??= []).push(i);
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} homeHref="/" />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/" className="text-sm text-ink-soft hover:text-forest-800">
          &larr; Admin
        </Link>
        <h1 className="display mt-2 text-3xl text-forest-900">Feedback</h1>
        <p className="text-sm text-ink-soft mt-1">
          Crash reports, bugs, ideas, and praise from users.
        </p>

        {(["new", "seen", "resolved", "dismissed"] as const).map((status) => {
          const arr = grouped[status] ?? [];
          if (arr.length === 0) return null;
          return (
            <section key={status} className="mt-8">
              <h2 className="text-xs uppercase tracking-[0.2em] text-gold-700">
                {status} ({arr.length})
              </h2>
              <ul className="mt-3 grid gap-3">
                {arr.map((f) => (
                  <li key={f.id} className="card p-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="display text-base text-forest-900">
                          {f.subject ?? "(no subject)"}
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          {KIND_LABEL[f.kind] ?? f.kind} -{" "}
                          {f.email ?? "anonymous"} -{" "}
                          {new Date(f.created_at).toLocaleString()}
                        </div>
                      </div>
                      <span
                        className={
                          "text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border " +
                          (f.kind === "crash"
                            ? "bg-red-50 border-red-200 text-red-700"
                            : f.kind === "bug"
                              ? "bg-amber-50 border-amber-200 text-amber-800"
                              : f.kind === "idea"
                                ? "bg-gold-50 border-gold-300 text-gold-700"
                                : f.kind === "praise"
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                  : "bg-white border-forest-100 text-ink-soft")
                        }
                      >
                        {KIND_LABEL[f.kind] ?? f.kind}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-forest-900 whitespace-pre-wrap leading-relaxed">
                      {f.body}
                    </p>
                    {f.page_url ? (
                      <div className="text-[11px] text-ink-muted mt-2 break-all">
                        From: {f.page_url}
                      </div>
                    ) : null}
                    {f.user_agent ? (
                      <div className="text-[11px] text-ink-muted break-all">
                        UA: {f.user_agent}
                      </div>
                    ) : null}
                    {f.admin_note ? (
                      <div className="mt-3 rounded-lg bg-cream/60 border border-forest-100 px-3 py-2 text-xs text-forest-800">
                        <span className="text-gold-700 uppercase tracking-wide text-[10px] mr-1">
                          Note:
                        </span>
                        {f.admin_note}
                      </div>
                    ) : null}

                    <form
                      action={updateFeedbackStatus}
                      className="mt-4 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="id" value={f.id} />
                      <select
                        name="status"
                        defaultValue={f.status}
                        className="input sm:w-40 text-xs"
                      >
                        <option value="new">New</option>
                        <option value="seen">Seen</option>
                        <option value="resolved">Resolved</option>
                        <option value="dismissed">Dismissed</option>
                      </select>
                      <input
                        name="admin_note"
                        type="text"
                        defaultValue={f.admin_note ?? ""}
                        className="input flex-1 min-w-0 text-xs"
                        placeholder="Internal note (optional)"
                      />
                      <button className="btn-ghost text-xs h-9 px-3">
                        Save
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {(items ?? []).length === 0 ? (
          <p className="mt-8 text-sm text-ink-muted">No feedback yet.</p>
        ) : null}
      </section>
    </main>
  );
}
