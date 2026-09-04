import Link from "next/link";
import type { TrialState } from "@/lib/plans/usage";
import { WebOnly } from "@/components/WebOnly";

/**
 * Top-of-page banner showing trial countdown or expired state.
 *
 * Active trial: quiet card with days remaining + "Pick a plan" CTA.
 * Ending soon: the same card tinted with the accent (last two days).
 * Expired:     red-tinted card with "Choose a plan". The user is
 *              technically on free now (getActivePlan returns 'free'
 *              once trial_end passes) but seeing this explicitly cued
 *              helps them remember why their AI just stopped working.
 *
 * Layout: label and call to action share the first row, the sentence
 * takes the full width beneath them, and from `sm` up all three sit on
 * one line. The earlier flex row gave the sentence `flex-1 min-w-0`
 * between two auto-width siblings, so the row never wrapped and the
 * sentence got whatever was left over: on a 344px cover screen that
 * was 29px, and body's `overflow-wrap: anywhere` turned it into a
 * 446px column of syllables that pushed the dashboard's figures below
 * the fold. Measured in components/TrialBanner.ct.spec.tsx.
 *
 * Colour comes from the semantic tokens (surface / edge / accent-2, and
 * the red utilities that already carry dark overrides), so the same
 * markup reads in both themes. The previous `bg-gold-50/70` and
 * `bg-red-50/60` tints had no dark twin and sat under text the theme
 * had flipped to cream: 1.3:1 in the dark theme.
 *
 * The whole banner links to /billing, so on native (App Store
 * Guideline 3.1.1) we swap it for a plain, non-tappable status line via
 * <WebOnly>, the user still sees their trial state, with no in-app
 * route to a purchase.
 */
export function TrialBanner({ trial }: { trial: TrialState }) {
  if (trial.kind === "none") return null;

  const statusText =
    trial.kind === "expired"
      ? "Your free trial has ended."
      : trial.daysRemaining === 1
        ? "1 day left on your free trial."
        : `${trial.daysRemaining} days left on your free trial.`;
  const nativeFallback = (
    <div className="mt-4 rounded-xl border border-edge bg-surface px-4 py-3 flex items-center gap-x-3 gap-y-1 flex-wrap">
      <span className="kicker-sm">
        {trial.kind === "expired" ? "Trial ended" : "Trial active"}
      </span>
      <span className="text-sm text-foreground">{statusText}</span>
    </div>
  );

  return <WebOnly fallback={nativeFallback}>{renderBanner(trial)}</WebOnly>;
}

function renderBanner(trial: Extract<TrialState, { kind: "expired" | "active" }>) {
  const tone =
    trial.kind === "expired"
      ? {
          box: "border-red-200 bg-red-50 hover:border-red-300",
          label: "text-red-700",
          body: "text-red-900",
          cta: "text-red-700",
        }
      : trial.daysRemaining <= 2
        ? {
            box: "border-accent-2/40 bg-accent-2/10 hover:border-accent-2",
            // The brass kicker passes on white and on navy, but on the
            // accent tint it measured 4.23:1. gold-800 is the ramp's
            // "body text on light" step and flips to gold-300 in the dark
            // theme with the other dark golds.
            label: "text-gold-800",
            body: "text-foreground",
            cta: "text-foreground",
          }
        : {
            box: "border-edge bg-surface hover:border-edge-bright",
            label: "",
            body: "text-foreground",
            cta: "text-foreground",
          };

  const label =
    trial.kind === "expired"
      ? "Trial ended"
      : trial.daysRemaining <= 2
        ? "Trial ending soon"
        : "Trial active";
  const body =
    trial.kind === "expired"
      ? "Pick a plan to bring back Bella, bank sync, and receipt OCR. Your data and remaining credits stay put."
      : `${
          trial.daysRemaining === 1
            ? "1 day left on your free trial."
            : `${trial.daysRemaining} days left on your free trial.`
        } You're on Solo with 400 credits and Bella on Sonnet.`;
  const cta = trial.kind === "expired" ? "Choose a plan" : "Pick a plan";

  return (
    <Link
      href="/billing"
      className={
        "mt-4 grid grid-cols-[1fr_auto] sm:grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 transition-colors " +
        tone.box
      }
    >
      <span className={"kicker-sm " + tone.label}>{label}</span>
      <span
        className={
          "order-last col-span-2 sm:order-none sm:col-span-1 text-sm " +
          tone.body
        }
      >
        {body}
      </span>
      <span
        className={
          "justify-self-end text-sm font-medium whitespace-nowrap " + tone.cta
        }
      >
        {cta} &rarr;
      </span>
    </Link>
  );
}
