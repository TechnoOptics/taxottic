import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import {
  addCustomDomain,
  refreshDomainStatus,
  removeCustomDomain,
} from "./actions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  pending_dns: "bg-amber-50 text-amber-800 border-amber-200",
  pending_ssl: "bg-gold-50 text-gold-800 border-gold-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  suspended: "bg-red-50 text-red-700 border-red-200",
  removed: "bg-cream-100 text-ink-muted border-forest-100",
};

const STATUS_LABEL: Record<string, string> = {
  pending_dns: "Waiting on DNS",
  pending_ssl: "Issuing SSL",
  active: "Live",
  suspended: "Suspended",
  removed: "Removed",
};

export default async function DomainSettingsPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();
  const isEnterprise = ctx.firm.tier === "enterprise";

  const { data: domains } = await admin
    .from("firm_custom_domains")
    .select(
      "id, hostname, status, vercel_domain_id, verification_record, added_at, verified_at, notes",
    )
    .eq("firm_id", ctx.firm.id)
    .neq("status", "removed")
    .order("added_at", { ascending: false });

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm/settings"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Settings
          </Link>{" "}
          · Custom domain
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Use your own domain.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          Enterprise-tier firms can point a domain you own (e.g.,
          <code className="font-mono"> smithcpa-secure.com</code>) at
          your Taxottic firm portal. Clients see your brand at the
          URL bar; we handle the SSL.
        </p>

        {!isEnterprise ? (
          <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm">
            <div className="font-semibold text-amber-900">
              Enterprise tier required.
            </div>
            <div className="mt-1 text-[13px] text-amber-900/90">
              Custom domains are an Enterprise-tier feature. Email{" "}
              <a
                href="mailto:contact@taxottic.com"
                className="underline hover:text-amber-700"
              >
                contact@taxottic.com
              </a>{" "}
              to upgrade.
            </div>
          </div>
        ) : null}

        {isEnterprise ? (
          <form action={addCustomDomain} className="card p-5 mt-6 grid gap-3">
            <h2 className="display text-base text-forest-900">
              Add a domain
            </h2>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-forest-800">
                Domain
              </span>
              <input
                type="text"
                name="hostname"
                placeholder="firm.smithcpa-secure.com"
                required
                pattern="[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
                className="input text-sm font-mono"
              />
              <span className="text-[10px] text-ink-muted">
                Use a subdomain you control. Do not enter the apex
                (smithcpa.com); apex domains require A records that
                Vercel can&apos;t verify without name-server delegation.
              </span>
            </label>
            <button type="submit" className="btn-primary text-sm">
              Connect domain
            </button>
          </form>
        ) : null}

        {(domains ?? []).length > 0 ? (
          <section className="mt-6">
            <h2 className="display text-base text-forest-900 mb-2">
              Your domains
            </h2>
            <ul className="grid gap-3">
              {(domains ?? []).map((d) => (
                <li key={d.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="display text-base text-forest-900 font-mono">
                          {d.hostname}
                        </span>
                        <span
                          className={
                            "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                            (STATUS_TONE[d.status] ?? "")
                          }
                        >
                          {STATUS_LABEL[d.status] ?? d.status}
                        </span>
                      </div>
                      {d.verification_record ? (
                        <div className="mt-2 rounded-lg bg-cream-100 p-3 text-xs font-mono text-forest-800 overflow-auto">
                          {(d.verification_record as Array<{
                            type: string;
                            domain: string;
                            value: string;
                            reason: string;
                          }>).map((v, i) => (
                            <div key={i}>
                              <strong>{v.type}</strong> · {v.domain}{" "}
                              → {v.value}{" "}
                              <span className="text-ink-muted">
                                ({v.reason})
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {d.notes ? (
                        <p className="mt-2 text-xs text-red-700">{d.notes}</p>
                      ) : null}
                      <div className="text-[11px] text-ink-muted mt-1">
                        Added{" "}
                        {new Date(d.added_at).toLocaleDateString()}
                        {d.verified_at
                          ? ` · Verified ${new Date(d.verified_at).toLocaleDateString()}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {d.status !== "active" ? (
                        <form action={refreshDomainStatus}>
                          <input type="hidden" name="id" value={d.id} />
                          <button className="btn-ghost text-xs px-3 h-9">
                            Check status
                          </button>
                        </form>
                      ) : null}
                      <form action={removeCustomDomain}>
                        <input type="hidden" name="id" value={d.id} />
                        <button className="btn-ghost text-xs px-3 h-9 hover:text-red-700">
                          Remove
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  );
}
