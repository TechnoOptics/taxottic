import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { decryptField } from "@/lib/crypto/field-encryption";
import { requestW9, markW9Verified, markW9Invalid } from "./actions";

type Params = Promise<{ engagementId: string }>;

const STATUS_TONE: Record<string, string> = {
  requested: "bg-amber-50 text-amber-800 border-amber-200",
  received: "bg-gold-50 text-gold-800 border-gold-200",
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expired: "bg-cream-100 text-ink-muted border-forest-100",
  invalid: "bg-red-50 text-red-700 border-red-200",
};

function maskTin(tin: string | null, tinType: string | null): string {
  if (!tin) return "-";
  const t = tin.replace(/\D/g, "");
  if (tinType === "ssn") {
    return t.length === 9 ? `XXX-XX-${t.slice(5)}` : "XXX-XX-XXXX";
  }
  if (tinType === "ein") {
    return t.length === 9 ? `XX-XXX${t.slice(5)}` : "XX-XXXXXXX";
  }
  return "XXX-XX-XXXX";
}

export default async function W9Page({ params }: { params: Params }) {
  const { engagementId } = await params;
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  const { data: eng } = await admin
    .from("firm_engagements")
    .select("id, tax_year, company:companies!inner(id, name, public_id)")
    .eq("id", engagementId)
    .eq("firm_id", ctx.firm.id)
    .maybeSingle();
  if (!eng) notFound();
  const company = (
    eng as unknown as { company: { id: string; name: string; public_id: string } }
  ).company;

  const { data: w9s } = await admin
    .from("firm_w9_forms")
    .select(
      "id, recipient_email, legal_name, business_name, entity_type, address_line_1, address_city, address_region, address_postal_code, tin_type, tin_digits, status, requested_at, signed_at, verified_at, expires_at, notes",
    )
    .eq("firm_id", ctx.firm.id)
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false })
    .limit(100);

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
          · W-9 collection
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          W-9 forms.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-2xl">
          IRS rules require a W-9 on file before issuing a 1099 to
          any contractor paid $600+ in a calendar year. Request the
          form here; the recipient fills + signs it via a one-time
          link. Once received, verify the data before running the
          1099 generator.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_22rem]">
          <section>
            <h2 className="display text-xl text-forest-900">Collected W-9s</h2>
            {(w9s ?? []).length === 0 ? (
              <div className="mt-3 card p-6 text-center">
                <p className="text-sm text-ink-soft">
                  No W-9s requested yet. Use the form on the right
                  to request one.
                </p>
              </div>
            ) : (
              <ul className="mt-3 grid gap-3">
                {(w9s ?? []).map((w) => (
                  <li key={w.id} className="card p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="display text-base text-forest-900">
                            {w.legal_name?.trim() || w.recipient_email}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border ${
                              STATUS_TONE[w.status] ?? ""
                            }`}
                          >
                            {w.status}
                          </span>
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>{w.recipient_email}</span>
                          {w.business_name ? (
                            <>
                              <span>·</span>
                              <span>{w.business_name}</span>
                            </>
                          ) : null}
                          {w.entity_type ? (
                            <>
                              <span>·</span>
                              <span className="capitalize">
                                {String(w.entity_type).replace(/_/g, " ")}
                              </span>
                            </>
                          ) : null}
                          {w.tin_digits ? (
                            <>
                              <span>·</span>
                              <span className="font-mono">
                                TIN: {maskTin(decryptField(w.tin_digits), w.tin_type)}
                              </span>
                            </>
                          ) : null}
                        </div>
                        {w.address_city ? (
                          <div className="text-xs text-ink-muted mt-0.5">
                            {[
                              w.address_line_1,
                              w.address_city,
                              w.address_region,
                              w.address_postal_code,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        ) : null}
                        {w.notes ? (
                          <p className="mt-2 text-xs text-red-700">
                            {w.notes}
                          </p>
                        ) : null}
                        <div className="text-[11px] text-ink-muted mt-1">
                          {w.signed_at
                            ? `Signed ${new Date(w.signed_at).toLocaleDateString()}`
                            : `Requested ${new Date(w.requested_at).toLocaleDateString()} · expires ${new Date(w.expires_at).toLocaleDateString()}`}
                          {w.verified_at
                            ? ` · Verified ${new Date(w.verified_at).toLocaleDateString()}`
                            : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {w.status === "received" ? (
                          <>
                            <form action={markW9Verified}>
                              <input type="hidden" name="id" value={w.id} />
                              <input
                                type="hidden"
                                name="engagement_id"
                                value={engagementId}
                              />
                              <button className="btn-primary text-xs px-3 h-9">
                                Mark verified
                              </button>
                            </form>
                            <form action={markW9Invalid}>
                              <input type="hidden" name="id" value={w.id} />
                              <input
                                type="hidden"
                                name="engagement_id"
                                value={engagementId}
                              />
                              <button className="btn-ghost text-xs px-3 h-9 hover:text-red-700">
                                Reject
                              </button>
                            </form>
                          </>
                        ) : null}
                        {w.status === "requested" ? (
                          <form action={requestW9}>
                            <input
                              type="hidden"
                              name="engagement_id"
                              value={engagementId}
                            />
                            <input
                              type="hidden"
                              name="recipient_email"
                              value={w.recipient_email}
                            />
                            <button className="btn-ghost text-xs px-3 h-9">
                              Re-send
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Request a new W-9 */}
          <aside>
            <form action={requestW9} className="card p-5 grid gap-3">
              <h2 className="display text-base text-forest-900">
                Request a W-9
              </h2>
              <input
                type="hidden"
                name="engagement_id"
                value={engagementId}
              />
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Recipient email
                </span>
                <input
                  type="email"
                  name="recipient_email"
                  required
                  placeholder="contractor@example.com"
                  className="input text-sm"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Recipient name (optional)
                </span>
                <input
                  type="text"
                  name="recipient_name"
                  placeholder="Riley Chen"
                  className="input text-sm"
                />
              </label>
              <button type="submit" className="btn-primary text-sm mt-1">
                Send request
              </button>
              <p className="text-[11px] text-ink-muted leading-relaxed">
                The recipient gets a branded email with a one-time
                fill link. The link is valid for 90 days.
              </p>
            </form>
          </aside>
        </div>
      </section>
    </main>
  );
}
