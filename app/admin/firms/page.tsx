import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { approveFirmRequest, rejectFirmRequest } from "./actions";

/**
 * Super-admin firm provisioning. Lists pending requests submitted via
 * the public form on enterprise.taxottic.com and gives a one-click
 * "Approve and invite owner" action that:
 *   1. Creates a firms row (status='active').
 *   2. Mints a firm_invitations row for the contact email with the
 *      'owner' role.
 *   3. Returns a one-shot copy-link so the super-admin can send the
 *      welcome to the firm directly.
 */
export default async function AdminFirmsPage() {
  await requireSuperAdmin();
  const admin = createServiceClient();

  const [{ data: pending }, { data: existingFirms }] = await Promise.all([
    admin
      .from("firm_access_requests")
      .select("*")
      .order("created_at", { ascending: false }),
    admin
      .from("firms")
      .select("id, public_id, name, status, tier, created_at, approved_at")
      .order("created_at", { ascending: false }),
  ]);

  const pendingList =
    (pending ?? []).filter((p) => p.status === "pending") ?? [];
  const reviewedList =
    (pending ?? []).filter((p) => p.status !== "pending") ?? [];

  return (
    <main className="min-h-screen">
      <AppHeader />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
              Super-admin <span className="text-gold-500">·</span> Enterprise
            </div>
            <h1 className="display mt-2 text-3xl text-forest-900">
              Tax preparer firms
            </h1>
            <div aria-hidden="true" className="gold-flourish mt-3">
              <span />
            </div>
          </div>
          <Link href="/admin" className="text-sm text-forest-700 hover:text-forest-900">
            ← All admin
          </Link>
        </div>

        {/* Pending access requests */}
        <section className="mt-8">
          <h2 className="display text-xl text-forest-900">
            Pending access requests
          </h2>
          {pendingList.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              Nothing waiting. Firms request access via the form on the
              enterprise marketing page.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {pendingList.map((p) => (
                <li key={p.id} className="card p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="display text-lg text-forest-900">
                        {p.firm_name}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5">
                        {p.contact_full_name} · {p.contact_email}
                        {p.contact_phone ? ` · ${p.contact_phone}` : ""}
                      </div>
                      {p.firm_size ? (
                        <div className="text-xs text-ink-muted mt-0.5">
                          Size: {p.firm_size}
                        </div>
                      ) : null}
                      {p.message ? (
                        <p className="text-sm text-ink-soft mt-2 leading-relaxed whitespace-pre-wrap">
                          {p.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      {new Date(p.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <form action={approveFirmRequest}>
                      <input type="hidden" name="request_id" value={p.id} />
                      <button className="btn-primary text-sm">
                        Approve and invite owner
                      </button>
                    </form>
                    <form action={rejectFirmRequest}>
                      <input type="hidden" name="request_id" value={p.id} />
                      <button className="btn-ghost text-sm">Reject</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Active firms */}
        <section className="mt-10">
          <h2 className="display text-xl text-forest-900">Active firms</h2>
          {existingFirms && existingFirms.length > 0 ? (
            <ul className="mt-4 grid gap-2">
              {existingFirms.map((f) => (
                <li
                  key={f.id}
                  className="rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-forest-900 truncate">
                      {f.name}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {f.public_id} · tier {f.tier} · {f.status}
                    </div>
                  </div>
                  <div className="text-[11px] text-ink-muted">
                    Created {new Date(f.created_at).toLocaleDateString()}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">No firms yet.</p>
          )}
        </section>

        {/* Reviewed requests history */}
        {reviewedList.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Recent reviews
            </h2>
            <ul className="mt-3 grid gap-2">
              {reviewedList.slice(0, 20).map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-forest-100 bg-white/60 px-3 py-2 text-xs text-ink-soft flex items-center justify-between gap-3"
                >
                  <span className="truncate">
                    <span className="font-medium text-forest-900">
                      {p.firm_name}
                    </span>{" "}
                    · {p.status}
                  </span>
                  <span className="text-ink-muted">
                    {p.reviewed_at
                      ? new Date(p.reviewed_at).toLocaleDateString()
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  );
}
