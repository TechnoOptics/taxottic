"use client";

import { useState } from "react";
import { formatCents } from "@/lib/tax/forecast";
import type { SavingsGoal } from "@/lib/tax/savings-goals";

const CATEGORY_COLORS: Record<
  SavingsGoal["category"],
  { dot: string; pill: string; label: string }
> = {
  retirement: { dot: "bg-forest-700", pill: "bg-forest-50 text-forest-800", label: "Retirement" },
  health: { dot: "bg-emerald-600", pill: "bg-emerald-50 text-emerald-800", label: "Health" },
  education: { dot: "bg-blue-600", pill: "bg-blue-50 text-blue-800", label: "Education" },
  investment: { dot: "bg-purple-600", pill: "bg-purple-50 text-purple-800", label: "Investment" },
  charitable: { dot: "bg-rose-600", pill: "bg-rose-50 text-rose-800", label: "Charitable" },
  energy: { dot: "bg-amber-600", pill: "bg-amber-50 text-amber-800", label: "Energy" },
  compliance: { dot: "bg-red-600", pill: "bg-red-50 text-red-800", label: "Compliance" },
};

/**
 * Collapsible savings-goal card.
 *
 * Default state: title + estimated savings + one-line "why" + Expand
 * link. Click to reveal step-by-step instructions, citations,
 * whoToContact, caveats, and the "Adopt as goal" form that POSTs to
 * the server action.
 */
export function SavingsGoalCard({
  goal,
  companyId,
  taxYear,
  alreadyAdopted,
  adoptAction,
}: {
  goal: SavingsGoal;
  companyId: string;
  taxYear: number;
  alreadyAdopted: boolean;
  adoptAction: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const tone = CATEGORY_COLORS[goal.category];

  return (
    <li
      className={
        "rounded-xl border bg-white px-4 py-4 sm:px-5 sm:py-5 transition-colors " +
        (open ? "border-gold-300/60" : "border-forest-100 hover:border-gold-300/60")
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 text-left"
        aria-expanded={open}
      >
        <span
          className={`mt-1.5 size-2.5 rounded-full shrink-0 ${tone.dot}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="display text-base text-forest-900">
              {goal.title}
            </span>
            <span
              className={`text-[10px] uppercase tracking-[0.18em] font-medium px-2 py-0.5 rounded-full ${tone.pill}`}
            >
              {tone.label}
            </span>
            {alreadyAdopted ? (
              <span className="text-[10px] uppercase tracking-[0.18em] font-medium px-2 py-0.5 rounded-full bg-gold-50 text-gold-800">
                Adopted
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-ink-soft leading-relaxed">
            {goal.why}
          </p>
          <div className="mt-2 flex items-center gap-3 flex-wrap text-xs">
            {goal.estimatedSavingsCents > 0 ? (
              <span className="text-forest-800 font-medium">
                Save ~{formatCents(goal.estimatedSavingsCents)}
              </span>
            ) : (
              <span className="text-ink-muted">Long-term tax-free growth</span>
            )}
            <span className="text-ink-muted">
              Deadline {prettyDate(goal.deadline)}
            </span>
            <span className="text-ink-muted">
              Target {formatCents(goal.targetContributionCents)}
            </span>
            <span className="ml-auto text-forest-700 font-medium">
              {open ? "Hide instructions" : "View instructions →"}
            </span>
          </div>
        </div>
      </button>

      {open ? (
        <div className="mt-4 pl-6 grid gap-4 text-sm">
          <section>
            <h3 className="text-[10px] uppercase tracking-[0.18em] text-gold-700 font-medium">
              Step-by-step
            </h3>
            <ol className="mt-2 grid gap-2 list-decimal list-outside pl-5 text-ink-soft leading-relaxed">
              {goal.instructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </section>

          {goal.whoToContact ? (
            <section>
              <h3 className="text-[10px] uppercase tracking-[0.18em] text-gold-700 font-medium">
                Who to contact
              </h3>
              <p className="mt-1 text-ink-soft">{goal.whoToContact}</p>
            </section>
          ) : null}

          {goal.caveats && goal.caveats.length > 0 ? (
            <section>
              <h3 className="text-[10px] uppercase tracking-[0.18em] text-gold-700 font-medium">
                Watch out for
              </h3>
              <ul className="mt-2 grid gap-1.5 text-ink-soft leading-relaxed">
                {goal.caveats.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-amber-700 mt-0.5">!</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.18em] text-gold-700 font-medium">
              Citations
            </h3>
            <p className="mt-1 text-xs text-ink-muted">
              {goal.citations.join(" · ")}
            </p>
          </section>

          {!alreadyAdopted ? (
            <form action={adoptAction} className="mt-2">
              <input type="hidden" name="goal_id" value={goal.id} />
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="tax_year" value={taxYear} />
              <input type="hidden" name="title" value={goal.title} />
              <input
                type="hidden"
                name="target_cents"
                value={goal.targetContributionCents}
              />
              <input type="hidden" name="deadline" value={goal.deadline} />
              <button type="submit" className="btn-primary text-sm">
                Adopt as a goal
              </button>
            </form>
          ) : (
            <p className="text-xs text-ink-muted">
              You&apos;ve adopted this. Track progress on{" "}
              <a href="/goals" className="text-forest-700 hover:underline">
                /goals
              </a>
              .
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
