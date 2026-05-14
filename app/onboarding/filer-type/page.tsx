import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { saveFilerType } from "./actions";

/**
 * The fork. Asked once at signup before any other onboarding step.
 *
 * This used to be a forced single-choice radio (W-2 vs business),
 * which hid the very common combined case (day-job W-2 + side hustle
 * 1099). Switched to two checkboxes so users with both can pick both;
 * the action maps the four selection states to the three filer-type
 * values in the DB:
 *
 *   W-2 only           → 'w2'           → /personal/forecast
 *   Business only      → 'business'     → /onboarding/new-company
 *   Both               → 'both'         → /onboarding/new-company
 *                                          (company first, then both
 *                                          forecasts share the dashboard)
 *   Neither            → form rejects
 *
 * If the user already picked, this page redirects out — it's
 * intentionally a one-shot. They can revisit /settings to change
 * later (forthcoming).
 */
export default async function FilerTypePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { admin, user } = await requireUserWithAdmin();
  const sp = await searchParams;

  const { data: profile } = await admin
    .from("profiles")
    .select("tax_filer_type")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.tax_filer_type) {
    redirect(sp.next ?? "/dashboard");
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="card p-7 sm:p-9">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Welcome
          </div>
          <h1 className="display mt-2 text-3xl text-forest-900">
            How do you make most of your income?
          </h1>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">
            Pick all that apply. We&apos;ll fit Taxottic to your tax
            situation. If you have W-2 wages AND run a business, check
            both — the forecast will combine them and show whether
            you&apos;ll owe or get a refund.
          </p>

          <form action={saveFilerType} className="mt-7 grid gap-3">
            <Choice
              value="w2"
              title="W-2 employee"
              body="My income includes a salary or hourly wage. My employer handles withholding. I file a personal 1040 and want help with W-4 tuning, retirement contributions, and year-end planning."
            />
            <Choice
              value="business"
              title="Business owner / freelancer / 1099"
              body="I run a business — sole prop, LLC, S-Corp, partnership — or earn 1099 income. I track Schedule C income and expenses and want help with quarterly estimates, deductions, and entity-level tax."
            />
            <p className="mt-1 text-xs text-ink-muted">
              Pick one, or both. We&apos;ll combine the math when you
              do both — your W-2 withholding can offset SE tax owed
              from the side, which often turns "owe" into "refund."
            </p>
            <button
              type="submit"
              className="btn-primary mt-3 self-start"
              name="submit"
              value="1"
            >
              Continue
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Choice({
  value,
  title,
  body,
}: {
  value: "w2" | "business";
  title: string;
  body: string;
}) {
  return (
    <label className="flex gap-3 p-4 rounded-xl border border-forest-100 bg-white cursor-pointer hover:border-gold-300">
      <input
        type="checkbox"
        name="filer_type"
        value={value}
        className="mt-1 size-4 accent-forest-700"
      />
      <div className="min-w-0">
        <div className="display text-base text-forest-900">{title}</div>
        <p className="text-xs text-ink-soft mt-1 leading-relaxed">{body}</p>
      </div>
    </label>
  );
}
