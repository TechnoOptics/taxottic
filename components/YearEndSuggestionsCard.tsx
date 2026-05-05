import Link from "next/link";
import { formatCents } from "@/lib/tax/forecast";
import type {
  Suggestion,
  SuggestionTone,
} from "@/lib/tax/year-end-suggestions";

const TONE_STYLES: Record<SuggestionTone, { dot: string; pill: string; label: string }> = {
  high: {
    dot: "bg-red-500",
    pill: "bg-red-50 text-red-700",
    label: "Act now",
  },
  medium: {
    dot: "bg-gold-500",
    pill: "bg-gold-50 text-gold-700",
    label: "Worth doing",
  },
  low: {
    dot: "bg-forest-500",
    pill: "bg-forest-50 text-forest-700",
    label: "Nice to have",
  },
};

export function YearEndSuggestionsCard({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="card mt-6 p-6 sm:p-7 border-gold-300/60">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Year-end moves
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            What you can still do this year
          </h2>
          <p className="mt-1 text-sm text-ink-soft leading-relaxed max-w-xl">
            Personalized for your numbers. Each one is calibrated to your
            marginal rate so the dollar impact is realistic, not generic.
          </p>
        </div>
      </div>

      <ul className="mt-5 grid gap-3">
        {suggestions.map((s) => {
          const tone = TONE_STYLES[s.tone];
          return (
            <li
              key={s.id}
              className="rounded-xl border border-forest-100 bg-white p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4"
            >
              <span
                className={`mt-1 size-2.5 rounded-full shrink-0 ${tone.dot}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="display text-base text-forest-900">
                    {s.title}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-[0.18em] font-medium px-2 py-0.5 rounded-full ${tone.pill}`}
                  >
                    {tone.label}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-soft leading-relaxed">
                  {s.body}
                </p>
                <div className="mt-2 flex items-center gap-3 flex-wrap">
                  {typeof s.estimatedSavingsCents === "number" &&
                  s.estimatedSavingsCents > 0 ? (
                    <span className="text-xs text-forest-800 font-medium">
                      Could save ~{formatCents(s.estimatedSavingsCents)}
                    </span>
                  ) : null}
                  {s.cta ? (
                    <Link
                      href={s.cta.href}
                      className="text-sm text-forest-700 hover:text-forest-900 underline-offset-2 hover:underline"
                    >
                      {s.cta.label} &rarr;
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
