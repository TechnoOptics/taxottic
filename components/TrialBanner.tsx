import Link from "next/link";
import type { TrialState } from "@/lib/plans/usage";

/**
 * Top-of-page banner showing trial countdown or expired state.
 *
 * Active trial: cream pill with days remaining + "Upgrade to keep
 * access" CTA.
 * Expired:    red-tinted pill with "Trial ended — choose a plan"
 *             CTA. The user is technically on free now (getActivePlan
 *             returns 'free' once trial_end passes) but seeing this
 *             explicitly cued helps them remember why their AI just
 *             stopped working.
 */
export function TrialBanner({ trial }: { trial: TrialState }) {
  if (trial.kind === "none") return null;

  if (trial.kind === "expired") {
    return (
      <Link
        href="/billing"
        className="block mt-4 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 hover:border-red-300 transition-colors"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.2em] text-red-700 font-medium">
            Trial ended
          </span>
          <span className="text-sm text-red-900 flex-1 min-w-0">
            Pick a plan to bring back Bella, bank sync, and receipt OCR. Your
            data and remaining credits stay put.
          </span>
          <span className="text-sm text-red-700 font-medium">
            Choose a plan &rarr;
          </span>
        </div>
      </Link>
    );
  }

  // Active trial
  const isLast = trial.daysRemaining <= 2;
  return (
    <Link
      href="/billing"
      className={
        "block mt-4 rounded-xl border px-4 py-3 transition-colors " +
        (isLast
          ? "border-gold-400 bg-gold-50/70 hover:border-gold-500"
          : "border-forest-100 bg-cream/50 hover:border-gold-300")
      }
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={
            "text-[10px] uppercase tracking-[0.2em] font-medium " +
            (isLast ? "text-gold-700" : "text-forest-700")
          }
        >
          {isLast ? "Trial ending soon" : "Trial active"}
        </span>
        <span className="text-sm text-forest-900 flex-1 min-w-0">
          {trial.daysRemaining === 1
            ? "1 day left on your free trial."
            : `${trial.daysRemaining} days left on your free trial.`}{" "}
          You&apos;re on Solo with 400 credits and Bella on Sonnet.
        </span>
        <span className="text-sm text-forest-700 font-medium">
          Pick a plan &rarr;
        </span>
      </div>
    </Link>
  );
}
