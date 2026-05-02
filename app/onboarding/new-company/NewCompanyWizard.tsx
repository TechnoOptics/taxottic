"use client";

import { useState } from "react";

type EntityType = { value: string; label: string; sub: string };
type State = { code: string; name: string };

type Props = {
  entityTypes: EntityType[];
  states: ReadonlyArray<State>;
  action: (formData: FormData) => Promise<void>;
};

type Stage = 0 | 1 | 2 | 3 | 4;

/**
 * Card-swipe wizard for creating a new company. Replaces the old
 * single-page form with one-question-per-card flow that's easier on
 * mobile and feels less like data entry.
 *
 * Stages:
 *   0. Hello / context
 *   1. Company name (text)
 *   2. Entity type (radio cards)
 *   3. State (searchable list)
 *   4. Review + submit
 *
 * State lives in this component; we only POST when the user confirms
 * on stage 4. No partial submissions, no orphan rows.
 */
export function NewCompanyWizard({ entityTypes, states, action }: Props) {
  const [stage, setStage] = useState<Stage>(0);
  const [name, setName] = useState("");
  const [entityType, setEntityType] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [stateQuery, setStateQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredStates = stateQuery.trim()
    ? states.filter(
        (s) =>
          s.name.toLowerCase().includes(stateQuery.toLowerCase()) ||
          s.code.toLowerCase().includes(stateQuery.toLowerCase()),
      )
    : states;

  function next() {
    setError(null);
    if (stage === 1 && !name.trim()) {
      setError("Pick a name for your company.");
      return;
    }
    if (stage === 2 && !entityType) {
      setError("Pick the entity type.");
      return;
    }
    if (stage === 3 && !stateCode) {
      setError("Pick the state where the company is registered.");
      return;
    }
    if (stage < 4) setStage((stage + 1) as Stage);
  }
  function back() {
    setError(null);
    if (stage > 0) setStage((stage - 1) as Stage);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("entity_type", entityType);
      fd.set("state_code", stateCode);
      await action(fd);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const totalStages = 5;

  return (
    <section className="max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Progress + back */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <button
          type="button"
          onClick={back}
          disabled={stage === 0 || submitting}
          className="text-xs text-ink-soft hover:text-forest-900 disabled:opacity-30"
        >
          ← Back
        </button>
        <div className="flex items-center gap-1.5">
          {Array.from({ length: totalStages }, (_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={
                "h-1 rounded-full transition-all " +
                (i === stage
                  ? "w-8 bg-gold-500"
                  : i < stage
                    ? "w-1.5 bg-gold-500"
                    : "w-1.5 bg-forest-100")
              }
            />
          ))}
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
          {stage + 1} / {totalStages}
        </span>
      </div>

      <div
        key={stage}
        className="card p-6 sm:p-8 wizard-card"
        // The :key change is what triggers the swipe-in animation.
      >
        {stage === 0 ? (
          <>
            <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
              New company
            </div>
            <h1 className="display mt-2 text-3xl text-forest-900">
              Let's set up your business.
            </h1>
            <p className="mt-3 text-sm text-ink-soft leading-relaxed">
              Three quick questions. You can edit any of these later
              under the company's profile. You'll be the manager and
              can invite teammates afterward.
            </p>
          </>
        ) : null}

        {stage === 1 ? (
          <>
            <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
              Step 1 of 3
            </div>
            <h2 className="display mt-2 text-3xl text-forest-900">
              What do you call it?
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              Use the working name; legal name can come later in the
              profile.
            </p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && next()}
              placeholder="e.g. Acme Photography LLC"
              className="input mt-5 text-lg py-3"
              maxLength={120}
            />
          </>
        ) : null}

        {stage === 2 ? (
          <>
            <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
              Step 2 of 3
            </div>
            <h2 className="display mt-2 text-3xl text-forest-900">
              How is it organized?
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              Drives Schedule C vs. Form 1065 vs. C-Corp math. Don't
              worry if you're not sure - go with your gut and we'll
              flag anything that looks off.
            </p>
            <ul className="mt-4 grid gap-2">
              {entityTypes.map((e) => {
                const checked = entityType === e.value;
                return (
                  <li key={e.value}>
                    <button
                      type="button"
                      onClick={() => setEntityType(e.value)}
                      className={
                        "w-full text-left rounded-xl border px-4 py-3 transition-colors " +
                        (checked
                          ? "border-forest-800 bg-forest-800 text-cream"
                          : "border-forest-100 bg-white/70 text-forest-900 hover:border-forest-300")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {e.label}
                        </span>
                        {checked ? (
                          <span className="text-[10px] uppercase tracking-wide text-gold-300 ml-auto">
                            Picked
                          </span>
                        ) : null}
                      </div>
                      <div
                        className={
                          "text-xs mt-1 leading-relaxed " +
                          (checked ? "text-cream/75" : "text-ink-muted")
                        }
                      >
                        {e.sub}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        {stage === 3 ? (
          <>
            <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
              Step 3 of 3
            </div>
            <h2 className="display mt-2 text-3xl text-forest-900">
              Where is it registered?
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              Used for state-tax estimates and the find-a-CPA card.
            </p>
            <input
              autoFocus
              value={stateQuery}
              onChange={(e) => setStateQuery(e.target.value)}
              placeholder="Search states"
              className="input mt-4"
            />
            <ul className="mt-3 grid gap-1 max-h-64 overflow-y-auto no-scrollbar pr-1">
              {filteredStates.map((s) => {
                const checked = stateCode === s.code;
                return (
                  <li key={s.code}>
                    <button
                      type="button"
                      onClick={() => setStateCode(s.code)}
                      className={
                        "w-full text-left flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors " +
                        (checked
                          ? "border-forest-800 bg-forest-800 text-cream"
                          : "border-forest-100 bg-white/70 text-forest-900 hover:border-forest-300")
                      }
                    >
                      <span>{s.name}</span>
                      <span
                        className={
                          "text-[11px] " +
                          (checked
                            ? "text-cream/70"
                            : "text-ink-muted")
                        }
                      >
                        {s.code}
                      </span>
                    </button>
                  </li>
                );
              })}
              {filteredStates.length === 0 ? (
                <li className="text-xs text-ink-muted text-center py-4">
                  No states match.
                </li>
              ) : null}
            </ul>
          </>
        ) : null}

        {stage === 4 ? (
          <form onSubmit={submit}>
            <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
              Review
            </div>
            <h2 className="display mt-2 text-3xl text-forest-900">
              Looks right?
            </h2>
            <ul className="mt-5 grid gap-3">
              <ReviewRow label="Name" value={name} />
              <ReviewRow
                label="Entity type"
                value={
                  entityTypes.find((e) => e.value === entityType)?.label ?? ""
                }
              />
              <ReviewRow
                label="State"
                value={
                  states.find((s) => s.code === stateCode)?.name ?? stateCode
                }
              />
            </ul>
            <p className="mt-5 text-xs text-ink-muted">
              You'll be the manager. The next screen is your personal
              tax profile (filing status, dependents, etc) so the
              forecast can run correctly.
            </p>
            {error ? (
              <p className="mt-3 text-sm text-red-700">{error}</p>
            ) : null}
            <button
              type="submit"
              className="btn-primary w-full mt-6"
              disabled={submitting}
            >
              {submitting ? "Creating..." : "Create company"}
            </button>
          </form>
        ) : null}
      </div>

      {/* Step navigation footer (not shown on review where the form
          handles its own submit) */}
      {stage < 4 ? (
        <div className="mt-5 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-muted">
            {stage === 0 ? (
              "30 seconds, three questions."
            ) : error ? (
              <span className="text-red-700">{error}</span>
            ) : (
              <>&nbsp;</>
            )}
          </p>
          <button
            type="button"
            onClick={next}
            className="btn-primary text-sm"
            disabled={submitting}
          >
            {stage === 0 ? "Let's go" : "Next"}
          </button>
        </div>
      ) : null}

      <style>{`
        .wizard-card {
          animation: wiz-card-in 220ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
        }
        @keyframes wiz-card-in {
          from { transform: translateX(28px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .wizard-card { animation: none; }
        }
      `}</style>
    </section>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-forest-100 pb-3 last:border-0">
      <span className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
        {label}
      </span>
      <span className="text-forest-900 font-medium text-right">
        {value || "—"}
      </span>
    </li>
  );
}
