import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { US_STATES } from "@/data/us-states";
import { createCompany } from "./actions";

const ENTITY_TYPES = [
  { value: "sole_prop", label: "Sole Proprietor" },
  { value: "single_llc", label: "Single-Member LLC" },
  { value: "multi_llc", label: "Multi-Member LLC" },
  { value: "s_corp", label: "S-Corp" },
  { value: "c_corp", label: "C-Corp" },
  { value: "partnership", label: "Partnership" },
  { value: "self_employed_1099", label: "1099 / Self-Employed" },
];

export default async function NewCompanyPage() {
  const { user } = await requireUser();
  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-xl mx-auto px-6 py-12">
        <div className="card p-8">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            New company
          </div>
          <h1 className="display mt-3 text-3xl text-forest-900">
            Tell us about the business.
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            You will be the manager. You can invite employees afterward.
          </p>

          <form action={createCompany} className="mt-7 grid gap-5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Company name
              </span>
              <input
                name="name"
                required
                className="input"
                placeholder="e.g. Acme Photography LLC"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Entity type
              </span>
              <select name="entity_type" required className="input" defaultValue="">
                <option value="" disabled>
                  Select entity type
                </option>
                {ENTITY_TYPES.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">State</span>
              <select name="state_code" required className="input" defaultValue="">
                <option value="" disabled>
                  Select state
                </option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <button className="btn-primary mt-2">Create company</button>
          </form>
        </div>
      </section>
    </main>
  );
}
