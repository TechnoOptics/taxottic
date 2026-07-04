import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { acceptTaxDisclaimer } from "./actions";

/**
 * The first screen a brand-new user sees (gated in the dashboard
 * before the filer-type fork). Goal: build confidence in Taxottic
 * AND get an affirmative, logged acknowledgement that the numbers are
 * forecasts/estimates, not a filed return or tax advice. One-shot:
 * once accepted we redirect out.
 */
export default async function DisclaimerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { admin, user } = await requireUserWithAdmin();
  const sp = await searchParams;

  const { data: profile } = await admin
    .from("profiles")
    .select("tax_disclaimer_accepted_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.tax_disclaimer_accepted_at) {
    redirect(sp.next ?? "/dashboard");
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="card p-5 sm:p-7 sm:p-9">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Welcome to Taxottic
          </div>
          <h1 className="display mt-2 text-3xl text-forest-900">
            Built carefully. Still an estimate.
          </h1>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed">
            Taxottic is built to give you a clear, trustworthy picture
            of where your taxes are heading. The engine is updated for
            the 2026 OBBBA changes and the latest published IRS
            guidelines, the deduction logic cites its sources, and we
            test the math hard before it reaches you.
          </p>

          <div className="mt-5 grid gap-3">
            <Point title="What you get">
              A federal + state forecast, deduction guidance, and
              quarterly-estimate planning that updates as you go, so
              there are no April surprises.
            </Point>
            <Point title="What it is not">
              A forecast is an <strong>estimate</strong>, not a filed
              return and not individualised tax, legal, or accounting
              advice. Your final return can differ, real returns
              depend on records, elections, and rules that can change.
              Edge cases or late IRS/state guidance mean a number can
              occasionally be off despite our best efforts.
            </Point>
            <Point title="How to use it well">
              Use Taxottic to plan and stay ahead, then confirm the
              final filing with a qualified tax professional. If you
              spot something that looks wrong, tell us, that feedback
              makes the engine better for everyone.
            </Point>
          </div>

          <form action={acceptTaxDisclaimer} className="mt-7 grid gap-4">
            <label className="flex gap-3 p-4 rounded-xl border border-forest-100 bg-white cursor-pointer hover:border-gold-300">
              <input
                type="checkbox"
                name="acknowledge"
                value="1"
                required
                className="mt-0.5 size-4 accent-forest-700"
              />
              <span className="text-sm text-ink-soft leading-relaxed">
                I understand Taxottic provides tax{" "}
                <strong>forecasts and estimates</strong>, that my
                actual return may differ, and that I should confirm my
                filing with a tax professional. I agree to the{" "}
                <a
                  href="/legal/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-forest-900"
                >
                  Terms
                </a>{" "}
                and{" "}
                <a
                  href="/legal/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-forest-900"
                >
                  Privacy Policy
                </a>
                .
              </span>
            </label>

            {sp.error ? (
              <p className="text-sm text-red-700" role="alert">
                {sp.error}
              </p>
            ) : null}

            <button
              type="submit"
              className="btn-primary self-start"
              name="submit"
              value="1"
            >
              I understand, continue
            </button>
            <p className="text-[11px] text-ink-muted leading-relaxed">
              This acknowledgement is recorded with a timestamp on your
              account. You can review the full Terms and Privacy Policy
              any time from your account menu.
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}

function Point({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-forest-100 bg-white p-4">
      <div className="display text-base text-forest-900">{title}</div>
      <p className="text-xs text-ink-soft mt-1 leading-relaxed">
        {children}
      </p>
    </div>
  );
}
