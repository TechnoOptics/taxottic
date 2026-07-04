import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { postComment, resolveComment, reopenComment } from "./actions";

// Tier 2 #6: Per-document comment thread.
//
// One-time PDF-annotation UI (bounding boxes on pages) is hard;
// here we ship a 90% solution: a per-document thread with an
// optional page_number for each comment. Reviewers leave comments
// like "page 4: this deduction looks low" and the resolution
// workflow tracks what's left. The page_number maps to PDF page
// when we ship the in-line annotation overlay later.

export const dynamic = "force-dynamic";

type Params = Promise<{ engagementId: string; documentId: string }>;

export default async function DocumentCommentsPage({
  params,
}: {
  params: Params;
}) {
  const { engagementId, documentId } = await params;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: doc } = await admin
    .from("firm_documents")
    .select(
      "id, firm_id, engagement_id, kind, filename, status, updated_at",
    )
    .eq("id", documentId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!doc) notFound();

  const { data: commentsRaw } = await admin
    .from("firm_document_comments")
    .select(
      "id, body, page_number, resolved_at, resolved_by, edited_at, created_at, author_id, profiles!firm_document_comments_author_id_fkey(full_name, email)",
    )
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(200);

  type CommentRow = {
    id: string;
    body: string;
    page_number: number | null;
    resolved_at: string | null;
    resolved_by: string | null;
    edited_at: string | null;
    created_at: string;
    author_id: string;
    profiles: { full_name: string | null; email: string };
  };
  const comments = ((commentsRaw ?? []) as unknown as CommentRow[]) ?? [];

  // Resolve "resolved_by" display names.
  const resolverIds = Array.from(
    new Set(
      comments
        .map((c) => c.resolved_by)
        .filter((x): x is string => !!x),
    ),
  );
  const { data: resolvers } = resolverIds.length
    ? await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", resolverIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const resolverName = new Map<string, string>();
  for (const r of resolvers ?? []) {
    resolverName.set(
      r.id,
      r.full_name?.trim() || r.email || r.id.slice(0, 8),
    );
  }

  const openCount = comments.filter((c) => !c.resolved_at).length;
  const resolvedCount = comments.length - openCount;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href={`/firm/clients/${engagementId}/documents`}
            className="underline decoration-dotted hover:text-forest-900"
          >
            Documents
          </Link>{" "}
          · Comments
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          {doc.filename ?? "Document"}
        </h1>
        <p className="mt-2 text-xs text-ink-muted">
          {openCount} open · {resolvedCount} resolved
        </p>

        <form
          action={postComment}
          className="card p-4 mt-6 grid gap-3"
        >
          <input
            type="hidden"
            name="document_id"
            value={doc.id}
          />
          <input
            type="hidden"
            name="engagement_id"
            value={engagementId}
          />
          <label className="grid gap-1">
            <span className="text-xs font-medium text-forest-800">
              New comment
            </span>
            <textarea
              name="body"
              required
              maxLength={4000}
              rows={3}
              placeholder="E.g. 'Page 3: confirm $1,800 home office number against utility bills.'"
              className="input text-sm"
            />
          </label>
          <div className="grid sm:grid-cols-[7rem_auto] gap-2 items-end">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-forest-800">
                Page
              </span>
              <input
                type="number"
                name="page_number"
                min={1}
                max={9999}
                placeholder="-"
                className="input text-sm"
              />
            </label>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary text-sm">
                Post comment
              </button>
            </div>
          </div>
        </form>

        <section className="mt-6 grid gap-3">
          {comments.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No comments yet. Use the box above to leave the first
              note.
            </p>
          ) : (
            comments.map((c) => (
              <article
                key={c.id}
                className={
                  "card p-4 " +
                  (c.resolved_at ? "opacity-70" : "")
                }
              >
                <header className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-medium text-forest-900">
                      {c.profiles.full_name ?? c.profiles.email}
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {new Date(c.created_at).toLocaleString()}
                      {c.edited_at ? " · edited" : ""}
                    </span>
                    {c.page_number ? (
                      <span className="inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border bg-cream-200 text-forest-800 border-forest-200">
                        Page {c.page_number}
                      </span>
                    ) : null}
                  </div>
                  {c.resolved_at ? (
                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                      Resolved
                      {c.resolved_by
                        ? ` · ${resolverName.get(c.resolved_by) ?? "-"}`
                        : ""}
                    </span>
                  ) : null}
                </header>
                <p className="mt-2 text-sm text-forest-900 leading-relaxed whitespace-pre-wrap">
                  {c.body}
                </p>
                <footer className="mt-3 flex gap-2">
                  {c.resolved_at ? (
                    <form action={reopenComment}>
                      <input type="hidden" name="id" value={c.id} />
                      <input
                        type="hidden"
                        name="document_id"
                        value={doc.id}
                      />
                      <input
                        type="hidden"
                        name="engagement_id"
                        value={engagementId}
                      />
                      <button className="btn-ghost text-xs px-3 h-8">
                        Reopen
                      </button>
                    </form>
                  ) : (
                    <form action={resolveComment}>
                      <input type="hidden" name="id" value={c.id} />
                      <input
                        type="hidden"
                        name="document_id"
                        value={doc.id}
                      />
                      <input
                        type="hidden"
                        name="engagement_id"
                        value={engagementId}
                      />
                      <button className="btn-ghost text-xs px-3 h-8 hover:text-emerald-700">
                        Mark resolved
                      </button>
                    </form>
                  )}
                </footer>
              </article>
            ))
          )}
        </section>
      </section>
    </main>
  );
}
