import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";
import { uploadCsv } from "./actions";

type Params = Promise<{ publicId: string }>;

export default async function ImportPage({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);

  const { data: imports } = await supabase
    .from("bank_imports")
    .select("id, filename, status, row_count, applied_count, created_at")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          {company.public_id}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Bank import</h1>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="import" />
        </div>

        <div className="card mt-6 p-6">
          <h2 className="display text-xl text-forest-900">Upload a CSV</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Export a transaction CSV from your bank or card and drop it here.
            We will sniff the columns, auto-categorize what we can, and let
            you review the rest before applying as expenses.
          </p>
          <form
            action={uploadCsv}
            encType="multipart/form-data"
            className="mt-5 grid gap-3"
          >
            <input type="hidden" name="company_id" value={company.id} />
            <label className="grid gap-2">
              <span className="text-sm font-medium text-forest-800">
                CSV file
              </span>
              <input
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-forest-200 file:bg-white file:px-4 file:py-2 file:text-forest-800 hover:file:bg-cream"
              />
            </label>
            <button className="btn-primary w-full sm:w-auto">
              Upload and parse
            </button>
          </form>
        </div>

        <div className="card mt-6 p-6">
          <h2 className="display text-xl text-forest-900">Past imports</h2>
          <ul className="mt-4 grid gap-2">
            {imports && imports.length > 0 ? (
              imports.map((imp) => (
                <li
                  key={imp.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-forest-100 bg-white/70 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-forest-900 truncate">
                      {imp.filename}
                    </div>
                    <div className="text-xs text-ink-muted mt-0.5">
                      {imp.row_count} rows - {imp.applied_count} applied -{" "}
                      <span className="uppercase tracking-wide">
                        {imp.status}
                      </span>{" "}
                      - {new Date(imp.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <Link
                    href={`/c/${publicId}/import/${imp.id}`}
                    className="btn-ghost text-xs px-3 h-9"
                  >
                    Review
                  </Link>
                </li>
              ))
            ) : (
              <li className="py-6 text-sm text-ink-muted">
                No imports yet. Upload one above to get started.
              </li>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}
