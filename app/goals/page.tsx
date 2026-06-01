import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { formatCents } from "@/lib/tax/forecast";
import { addGoal, deleteGoal, recordSaved } from "./actions";
import { SelectMenu } from "@/components/ui/SelectMenu";

const GOAL_TYPES = [
  { value: "tax_savings_total", label: "Total tax savings target" },
  { value: "monthly_set_aside", label: "Monthly set-aside" },
  { value: "quarterly_payment", label: "Quarterly estimated payment" },
  { value: "deduction_capture", label: "Deduction capture" },
  { value: "custom", label: "Custom" },
];

export default async function GoalsPage() {
  const { supabase, user } = await requireUser();
  const taxYear = new Date().getUTCFullYear();

  const { data: companies } = await supabase
    .from("company_members")
    .select("company_id, company:companies(id, public_id, name)")
    .order("joined_at");

  const { data: goals } = await supabase
    .from("goals")
    .select(
      "id, company_id, tax_year, goal_type, title, target_cents, saved_cents, deadline, status, company:companies(name, public_id)",
    )
    .eq("status", "active")
    .order("created_at", { ascending: false });

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Goals
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Set aside what you owe.
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-lg">
          Pick a target, log what you have set aside as you go, and watch the
          gap close.
        </p>

        <section className="mt-8 card p-6">
          <h2 className="display text-xl text-forest-900">New goal</h2>
          <form action={addGoal} className="mt-4 grid sm:grid-cols-2 gap-3">
            <input type="hidden" name="tax_year" value={taxYear} />
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-forest-800">Title</span>
              <input
                name="title"
                required
                className="input"
                placeholder="e.g. Cover Q3 estimated tax"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">Type</span>
              <SelectMenu
                name="goal_type"
                ariaLabel="Goal type"
                defaultValue="tax_savings_total"
                options={GOAL_TYPES.map((t) => ({
                  value: t.value,
                  label: t.label,
                }))}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Target amount
              </span>
              <input
                name="target_amount"
                type="text"
                inputMode="decimal"
                required
                placeholder="$5,000"
                className="input"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Deadline (optional)
              </span>
              <input name="deadline" type="date" className="input" />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-forest-800">
                Apply to (optional)
              </span>
              <SelectMenu
                name="company_id"
                ariaLabel="Apply goal to"
                defaultValue=""
                options={[
                  { value: "", label: "Personal" },
                  ...(companies ?? []).map((m) => {
                    const c = m.company as unknown as {
                      id: string;
                      name: string;
                    };
                    return { value: c.id, label: c.name };
                  }),
                ]}
              />
            </label>
            <div className="sm:col-span-2">
              <button className="btn-primary w-full sm:w-auto">Add goal</button>
            </div>
          </form>
        </section>

        <section className="mt-8 grid gap-4">
          {goals && goals.length > 0 ? (
            goals.map((g) => (
              <GoalCard
                key={g.id}
                goal={g as unknown as GoalRow}
              />
            ))
          ) : (
            <p className="text-sm text-ink-muted">
              No active goals. Set your first one above.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}

type GoalRow = {
  id: string;
  company_id: string | null;
  tax_year: number;
  goal_type: string;
  title: string;
  target_cents: number;
  saved_cents: number;
  deadline: string | null;
  status: string;
  company: { name: string; public_id: string } | null;
};

function GoalCard({ goal }: { goal: GoalRow }) {
  const pct = goal.target_cents > 0
    ? Math.min(100, Math.round((goal.saved_cents / goal.target_cents) * 100))
    : 0;

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="display text-xl text-forest-900">{goal.title}</h3>
          <div className="text-xs text-ink-muted mt-1 tracking-wide">
            {goal.company?.name ? `${goal.company.name} - ` : ""}
            {prettyType(goal.goal_type)}
            {goal.deadline
              ? ` - by ${new Date(goal.deadline).toLocaleDateString()}`
              : ""}
          </div>
        </div>
        <form action={deleteGoal}>
          <input type="hidden" name="id" value={goal.id} />
          <button className="text-xs text-ink-muted hover:text-red-700">
            Remove
          </button>
        </form>
      </div>

      <div className="mt-4 flex items-baseline justify-between text-sm">
        <span className="text-ink-soft">
          {formatCents(goal.saved_cents)} saved of{" "}
          <span className="text-forest-900 font-medium">
            {formatCents(goal.target_cents)}
          </span>
        </span>
        <span className="display text-base text-forest-900">{pct}%</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-forest-50 overflow-hidden">
        <div
          className="h-full bg-gold-400"
          style={{ width: `${pct}%` }}
          aria-label={`${pct}% complete`}
        />
      </div>

      <form action={recordSaved} className="mt-4 flex gap-2">
        <input type="hidden" name="id" value={goal.id} />
        <input
          name="amount"
          type="text"
          inputMode="decimal"
          required
          placeholder="Add saved amount"
          className="input flex-1"
        />
        <button className="btn-ghost">Log save</button>
      </form>
    </div>
  );
}

function prettyType(t: string): string {
  return (
    {
      tax_savings_total: "Total tax savings",
      monthly_set_aside: "Monthly set-aside",
      quarterly_payment: "Quarterly payment",
      deduction_capture: "Deduction capture",
      custom: "Custom",
    }[t] ?? t
  );
}
