import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { PaystubUploader } from "@/components/PaystubUploader";
import { requireUserWithAdmin } from "@/lib/auth";
import { formatCents } from "@/lib/tax/forecast";
import { applyPaystubAnnualization } from "./actions";

/**
 * Personal pay-stub intake. Upload 1-3 consecutive stubs, Bella reads
 * income + withholding + pre-tax deductions, we annualize (schedule
 * inferred from the dates, YTD-anchored when printed), the user
 * reviews, and one click writes the W-2 picture onto the tax profile
 * that drives the personal forecast + bracket stats.
 */
export default async function PersonalPaystubPage() {
  const { admin, user } = await requireUserWithAdmin();
  const taxYear = new Date().getUTCFullYear();

  const { data: taxProfile } = await admin
    .from("tax_profiles")
    .select(
      "owner_w2_wages_cents, owner_w2_withheld_cents, owner_w2_ss_wages_cents",
    )
    .eq("user_id", user.id)
    .eq("tax_year", taxYear)
    .maybeSingle();
  if (!taxProfile) {
    redirect("/onboarding/tax-profile?next=/personal/paystub");
  }

  const currentWages = (taxProfile.owner_w2_wages_cents as number) ?? 0;
  const currentWithheld = (taxProfile.owner_w2_withheld_cents as number) ?? 0;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Personal · Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          Forecast from your pay stubs
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-xl leading-relaxed">
          Snap or upload up to three consecutive pay stubs. Taxottic reads
          your gross pay, federal withholding, and pre-tax deductions
          (401k, health premiums, HSA), figures out your pay schedule from
          the dates, and projects your full-year taxes — brackets and all.
        </p>

        {currentWages > 0 ? (
          <div className="card mt-6 p-4 text-sm text-ink-soft flex flex-wrap items-baseline gap-x-2">
            <span>Currently on your profile:</span>
            <span className="text-forest-900 font-medium tabular-nums">
              {formatCents(currentWages)} wages
            </span>
            <span>·</span>
            <span className="text-forest-900 font-medium tabular-nums">
              {formatCents(currentWithheld)} withheld
            </span>
            <span className="text-ink-muted text-xs">
              (applying a stub read replaces these)
            </span>
          </div>
        ) : null}

        <div className="mt-6">
          <PaystubUploader applyAction={applyPaystubAnnualization} />
        </div>

        <p className="mt-8 text-[11px] text-ink-muted leading-relaxed max-w-xl">
          Privacy: stubs are read once by Bella and never stored. Prefer
          typing the numbers yourself? Use{" "}
          <Link
            href="/onboarding/tax-profile?next=/personal/forecast"
            className="underline decoration-dotted"
          >
            the household profile form
          </Link>{" "}
          — a W-2 upload lives there too.
        </p>
      </section>
    </main>
  );
}
