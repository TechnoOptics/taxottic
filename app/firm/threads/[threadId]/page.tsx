import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { postMessage, archiveThread } from "../actions";

export const dynamic = "force-dynamic";

type Params = Promise<{ threadId: string }>;

export default async function ThreadDetailPage({
  params,
}: {
  params: Params;
}) {
  const { threadId } = await params;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: thread } = await admin
    .from("firm_threads")
    .select("id, firm_id, title, engagement_id, created_at, archived_at")
    .eq("id", threadId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!thread) notFound();

  const { data: messages } = await admin
    .from("firm_messages")
    .select(
      "id, body, author_id, attachments, edited_at, created_at, profiles!firm_messages_author_id_fkey(full_name, email, avatar_url)",
    )
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(200);

  type Row = {
    id: string;
    body: string;
    author_id: string;
    attachments: unknown;
    edited_at: string | null;
    created_at: string;
    profiles: {
      full_name: string | null;
      email: string;
      avatar_url: string | null;
    };
  };
  const rows = (messages ?? []) as unknown as Row[];

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm/threads"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Threads
          </Link>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 mt-2">
          <h1 className="display text-2xl sm:text-3xl text-forest-900 leading-tight">
            {thread.title}
          </h1>
          <form action={archiveThread}>
            <input type="hidden" name="id" value={thread.id} />
            <button className="btn-ghost text-xs px-3 h-9 hover:text-red-700">
              Archive thread
            </button>
          </form>
        </div>

        <section className="mt-6 grid gap-3">
          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No messages yet. Be the first.
            </p>
          ) : (
            rows.map((m) => (
              <article
                key={m.id}
                className="card p-4 grid grid-cols-[auto_1fr] gap-3"
              >
                <div className="size-9 rounded-full bg-cream-200 flex items-center justify-center text-sm font-medium text-forest-800 shrink-0">
                  {(m.profiles.full_name?.[0] ?? m.profiles.email[0]).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-medium text-forest-900">
                      {m.profiles.full_name ?? m.profiles.email}
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {new Date(m.created_at).toLocaleString("en-US")}
                      {m.edited_at ? " · edited" : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-forest-900 leading-relaxed whitespace-pre-wrap">
                    {m.body}
                  </p>
                </div>
              </article>
            ))
          )}
        </section>

        <form action={postMessage} className="card p-4 mt-6 grid gap-3">
          <input type="hidden" name="thread_id" value={thread.id} />
          <label className="grid gap-1">
            <span className="text-xs font-medium text-forest-800">
              Reply
            </span>
            <textarea
              name="body"
              required
              maxLength={8000}
              rows={3}
              placeholder="Type your message…"
              className="input text-sm"
            />
          </label>
          <div className="flex justify-end">
            <button type="submit" className="btn-primary text-sm">
              Post
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
