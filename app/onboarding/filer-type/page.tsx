import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { saveFilerType } from "./actions";

/**
 * The fork. Asked once at signup before any other onboarding step.
 *
 * Wage employee → personal-only mode (no company creation, no
 * Schedule C; the dashboard surfaces a personal forecast tile).
 * Business / freelance → existing company-creation flow.
 *
 * If the user already picked, this page redirects out — it's
 * intentionally a one-shot. They can always create a company later
 * which auto-flips them to 'business' anyway.
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
    <main className="min-h-screen">
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
            We use this to fit Taxottic to your tax situation. You can switch
            later — picking now just gets the right tools in front of you.
          </p>

          <form action={saveFilerType} className="mt-7 grid gap-3">
            <Choice
              value="w2"
              title="W-2 employee"
              body="My income comes from a salary or hourly wage. My employer handles withholding. I file a personal 1040 and want help with W-4 tuning, retirement contributions, and year-end planning."
            />
            <Choice
              value="business"
              title="Business owner / freelancer / 1099"
              body="I run a business — sole prop, LLC, S-Corp, partnership — or earn 1099 income. I track Schedule C income and expenses and want help with quarterly estimates, deductions, and entity-level tax."
            />
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
        type="radio"
        name="filer_type"
        value={value}
        className="mt-1 size-4 accent-forest-700"
        required
      />
      <div className="min-w-0">
        <div className="display text-base text-forest-900">{title}</div>
        <p className="text-xs text-ink-soft mt-1 leading-relaxed">{body}</p>
      </div>
    </label>
  );
}
