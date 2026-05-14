import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";

type Params = Promise<{ engagementId: string; documentId: string }>;

export default async function DocumentVersionsPage({
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
      "id, firm_id, engagement_id, kind, status, filename, content_type, size_bytes, sha256, created_at, updated_at, provider, provider_envelope_id",
    )
    .eq("id", documentId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!doc) notFound();

  const { data: versions } = await admin
    .from("firm_document_versions")
    .select(
      "id, version, filename, content_type, size_bytes, sha256, kind, status, provider, provider_envelope_id, notes, reason, versioned_by, created_at",
    )
    .eq("document_id", documentId)
    .order("version", { ascending: false });

  // Resolve "versioned_by" display names.
  const userIds = Array.from(
    new Set(
      (versions ?? [])
        .map((v) => v.versioned_by)
        .filter((x): x is string => !!x),
    ),
  );
  const { data: profiles } = userIds.length
    ? await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const nameById = new Map<string, string>();
  for (const p of profiles ?? []) {
    nameById.set(p.id, p.full_name?.trim() || p.email || p.id.slice(0, 8));
  }

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
          ·{" "}
          <Link
            href={`/firm/clients/${engagementId}/documents`}
            className="underline decoration-dotted hover:text-forest-900"
          >
            Documents
          </Link>{" "}
          · Versions
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          {doc.filename}
        </h1>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          Every saved state of this document. The current row sits at
          the top; older versions stay accessible for audit + compliance
          retrieval. Use the PDF link to download a specific version.
        </p>

        <ul className="mt-8 grid gap-3">
          <li className="card p-4 border-emerald-300">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="display text-base text-forest-900">
                    Current
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                    {doc.status}
                  </span>
                </div>
                <div className="text-xs text-ink-muted mt-0.5">
                  {doc.filename} ·{" "}
                  {formatBytes(doc.size_bytes ?? 0)} · Updated{" "}
                  {new Date(doc.updated_at).toLocaleString()}
                </div>
              </div>
              <Link
                href={`/api/firm/documents/${doc.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="btn-primary text-xs px-3 h-9"
              >
                PDF
              </Link>
            </div>
          </li>
          {(versions ?? []).map((v) => (
            <li key={v.id} className="card p-4">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="display text-base text-forest-900">
                      Version {v.version}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border bg-cream-200 text-forest-800 border-forest-200">
                      {v.status}
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {v.filename} ·{" "}
                    {formatBytes(v.size_bytes ?? 0)} ·{" "}
                    {new Date(v.created_at).toLocaleString()}
                    {v.versioned_by && nameById.get(v.versioned_by)
                      ? ` · by ${nameById.get(v.versioned_by)}`
                      : ""}
                  </div>
                  {v.reason ? (
                    <div className="text-xs text-ink-soft mt-1">
                      <strong>Reason:</strong> {v.reason}
                    </div>
                  ) : null}
                  {v.sha256 ? (
                    <div className="text-[10px] text-ink-muted mt-1 font-mono">
                      sha256: {v.sha256.slice(0, 16)}…
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-[11px] text-ink-muted leading-relaxed">
          Versions snapshot the document state immediately before
          any edit. Newer versions overwrite the current row, but
          the snapshot rows persist for audit retrieval.
        </p>
      </section>
    </main>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} kB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
