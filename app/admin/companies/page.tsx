import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { createServiceClient } from "@/lib/supabase/server";
import { deleteCompanyHard } from "../actions";
import { TypedConfirmDelete } from "@/components/admin/TypedConfirmDelete";

// Super-admin companies list, every company, including soft-deleted
// (deleted_at not null), with a per-row Permanently delete action.
//
// This is the LAST step beyond the recycle bin: soft-deleted companies
// are still recoverable from /settings/recycle-bin. Hard-delete here is
// final; FK cascades remove all child rows in one transaction.

export const dynamic = "force-dynamic";

type CompanyRow = {
  id: string;
  public_id: string;
  name: string;
  entity_type: string | null;
  created_at: string;
  deleted_at: string | null;
};

export default async function AdminCompaniesPage() {
  await requireSuperAdmin();
  const admin = createServiceClient();
  const { data } = await admin
    .from("companies")
    .select("id, public_id, name, entity_type, created_at, deleted_at")
    .order("created_at", { ascending: false })
    .limit(500);
  const companies = (data ?? []) as CompanyRow[];

  const active = companies.filter((c) => !c.deleted_at);
  const softDeleted = companies.filter((c) => !!c.deleted_at);

  return (
    <main id="main" className="min-h-screen">
      <AppHeader />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/admin"
            className="underline decoration-dotted hover:text-forest-900"
          >
            ← Admin
          </Link>
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Companies
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Every company in the system. Use this to permanently delete test
          companies and start fresh. Hard-delete cascades through every
          table that references the company; there is no Undo.
        </p>

        <h2 className="display text-xl text-forest-900 mt-8">
          Active ({active.length})
        </h2>
        <CompanyList rows={active} />

        {softDeleted.length > 0 ? (
          <>
            <h2 className="display text-xl text-forest-900 mt-8">
              In recycle bin, soft-deleted ({softDeleted.length})
            </h2>
            <p className="text-xs text-ink-muted">
              Still recoverable from the owner&apos;s /settings/recycle-bin.
              Hard-delete here removes them permanently.
            </p>
            <CompanyList rows={softDeleted} />
          </>
        ) : null}
      </section>
    </main>
  );
}

function CompanyList({ rows }: { rows: CompanyRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-sm text-ink-muted">No companies in this bucket.</p>
    );
  }
  return (
    <ul className="mt-3 grid gap-3">
      {rows.map((c) => (
        <li
          key={c.id}
          className="card p-4 grid sm:grid-cols-[1fr_auto] gap-3 items-start"
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-forest-900">
              {c.name || "(unnamed)"}
            </div>
            <div className="text-xs text-ink-muted mt-0.5">
              {c.entity_type ?? "-"} · created{" "}
              {new Date(c.created_at).toLocaleDateString()}
              {c.deleted_at
                ? ` · soft-deleted ${new Date(
                    c.deleted_at,
                  ).toLocaleDateString()}`
                : null}
              {" · "}
              <Link
                href={`/c/${c.public_id}/dashboard`}
                className="underline decoration-dotted"
              >
                view
              </Link>
            </div>
          </div>
          <details className="text-sm">
            <summary
              className="cursor-pointer text-xs uppercase tracking-wide"
              style={{ color: "#b91c1c" }}
            >
              Permanently delete
            </summary>
            <div className="mt-3">
              <TypedConfirmDelete
                formAction={deleteCompanyHard}
                hiddenFields={{ company_id: c.id }}
                inputName="confirm_name"
                requireText={c.name ?? ""}
                label={`Type the company name to confirm: "${c.name ?? ""}"`}
                placeholder={c.name ?? ""}
                buttonText="Delete company permanently"
                destructiveCopy="Cascades through bank_transactions, mileage_trips, deductions, goals, expenses, income, invoices, etc. No Undo. Logged."
              />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
