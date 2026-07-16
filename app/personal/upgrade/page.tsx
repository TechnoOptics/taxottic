import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { getPersonalAccess } from "@/lib/entitlements/personal-access.server";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Your personal tax tools · Taxottic" };

/**
 * Upsell shown to employee-only accounts that don't yet have their own
 * paid personal plan. Owners / unlocked users never land here (they're
 * redirected back to their personal forecast).
 */
export default async function PersonalUpgradePage() {
  const { locked, userId } = await getPersonalAccess();
  if (!userId) redirect("/login?next=/personal/upgrade");
  // Already entitled → send them to the real personal hub.
  if (!locked) redirect("/personal/forecast");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  const firstName = profile?.full_name?.split(" ")[0] ?? null;

  const perks = [
    {
      title: "Your own tax forecast",
      body: "See what you'll owe or get back, updated as your pay and deductions change.",
    },
    {
      title: "Personal deduction finder",
      body: "IRS-cited moves matched to your situation — separate from anything at work.",
    },
    {
      title: "Savings playbook & goals",
      body: "A vetted, step-by-step plan for lowering your personal tax bill.",
    },
    {
      title: "Private to you",
      body: "Your employer never sees your personal numbers, and you never see theirs.",
    },
  ];

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={undefined} />
      <section className="max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Personal tax tools
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          {firstName ? `${firstName}, make your ` : "Make your "}
          own tax plan.
        </h1>
        <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
          Your work account covers expenses, mileage, and team chat. Your{" "}
          <span className="font-medium text-forest-800">personal</span> tax
          forecast and savings tools are a separate, private plan you own —
          not tied to your employer.
        </p>

        <ul className="mt-7 grid gap-4">
          {perks.map((p) => (
            <li key={p.title} className="card p-4 sm:p-5">
              <div className="text-sm font-semibold text-forest-900">
                {p.title}
              </div>
              <div className="mt-1 text-sm text-ink-soft leading-relaxed">
                {p.body}
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <Link href="/billing?plan=solo&for=personal" className="btn-primary">
            See personal plans
          </Link>
          <Link href="/mileage" className="btn-ghost text-center">
            Back to work tools
          </Link>
        </div>
      </section>
    </main>
  );
}
