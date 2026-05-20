"use client";

import { useState } from "react";
import { rethrowIfRedirect } from "@/lib/next/redirect-error";

type EntityType = { value: string; label: string; sub: string };
type State = { code: string; name: string };

type Props = {
  entityTypes: EntityType[];
  states: ReadonlyArray<State>;
  action: (formData: FormData) => Promise<void>;
  /** Whether to ask for the user's full name on the welcome stage. */
  askForName?: boolean;
  /** Fallback display when we don't yet have a name. */
  ownerEmail?: string;
};

// 0 welcome · 1 name · 2 entity · 3 state · 4 review
type Stage = 0 | 1 | 2 | 3 | 4;

/**
 * Card-shuffle wizard for creating a new company.
 *
 * Goals (from product direction): make this feel celebratory, not
 * like data entry. Warm welcome → bite-size tile per question →
 * "why we ask" copy on each → review-then-confirm. Each card slides
 * + tilts away and a fresh one shuffles in with a soft gold sheen,
 * giving the whole flow a magical, intentional feel. The animation
 * is direction-aware (forward vs back) so the spatial metaphor is
 * consistent.
 */
export function NewCompanyWizard({
  entityTypes,
  states,
  action,
  askForName = false,
  ownerEmail = "",
}: Props) {
  const [stage, setStage] = useState<Stage>(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [fullName, setFullName] = useState("");
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
    // Welcome stage has no required input — full name is optional on
    // first-company askForName runs (collected in /settings later if
    // skipped here).
    if (stage === 1 && !name.trim()) {
      setError("Pick a name for your company.");
      return;
    }
    if (stage === 2 && !entityType) {
      setError("Pick how it's organised.");
      return;
    }
    if (stage === 3 && !stateCode) {
      setError("Pick the state where it's registered.");
      return;
    }
    if (stage < 4) {
      setDirection("forward");
      setStage((stage + 1) as Stage);
    }
  }
  function back() {
    setError(null);
    if (stage > 0) {
      setDirection("back");
      setStage((stage - 1) as Stage);
    }
  }
  function jumpTo(target: Stage) {
    setError(null);
    setDirection(target > stage ? "forward" : "back");
    setStage(target);
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
      if (askForName && fullName.trim()) {
        fd.set("owner_full_name", fullName.trim());
      }
      await action(fd);
    } catch (err) {
      rethrowIfRedirect(err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  const totalStages = 5;
  const entityLabel =
    entityTypes.find((e) => e.value === entityType)?.label ?? "";
  const stateLabel =
    states.find((s) => s.code === stateCode)?.name ?? stateCode;

  return (
    <section className="max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Progress ribbon — gold dots that fill as you advance. */}
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
                "h-1 rounded-full transition-all duration-300 " +
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

      {/* Card-shuffle stage. The `key` change unmounts/remounts so the
          CSS keyframes fire on each transition; `data-dir` picks the
          right entry direction so "back" feels spatially correct. */}
      <div
        key={stage}
        data-dir={direction}
        className="card wizard-card p-6 sm:p-8 relative overflow-hidden"
      >
        {/* Sheen — a faint gold gradient that sweeps across the new
            card on entry. Pure decoration; doesn't affect layout. */}
        <span aria-hidden="true" className="wizard-sheen" />

        {stage === 0 ? (
          <WelcomeStage
            askForName={askForName}
            ownerEmail={ownerEmail}
            fullName={fullName}
            setFullName={setFullName}
            onEnter={next}
          />
        ) : null}

        {stage === 1 ? (
          <NameStage
            name={name}
            setName={setName}
            onEnter={next}
          />
        ) : null}

        {stage === 2 ? (
          <EntityStage
            entityTypes={entityTypes}
            entityType={entityType}
            setEntityType={setEntityType}
          />
        ) : null}

        {stage === 3 ? (
          <StateStage
            states={filteredStates}
            stateQuery={stateQuery}
            setStateQuery={setStateQuery}
            stateCode={stateCode}
            setStateCode={setStateCode}
          />
        ) : null}

        {stage === 4 ? (
          <ReviewStage
            name={name}
            entityLabel={entityLabel}
            stateLabel={stateLabel}
            error={error}
            submitting={submitting}
            onSubmit={submit}
            onEditName={() => jumpTo(1)}
            onEditEntity={() => jumpTo(2)}
            onEditState={() => jumpTo(3)}
          />
        ) : null}
      </div>

      {/* Footer nav — hidden on review (the form has its own submit). */}
      {stage < 4 ? (
        <div className="mt-5 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-muted">
            {error ? (
              <span className="text-red-700">{error}</span>
            ) : stage === 0 ? (
              "Takes under a minute."
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
            {stage === 0 ? "Let's go ✨" : "Next →"}
          </button>
        </div>
      ) : null}

      {/* Card-shuffle CSS. Direction-aware keyframes so cards leave +
          arrive from the spatially-correct side. A faint gold sheen
          (.wizard-sheen) sweeps across each fresh card. Reduced-
          motion users get a static fade. */}
      <style>{`
        .wizard-card {
          position: relative;
          will-change: transform, opacity;
        }
        .wizard-card[data-dir="forward"] {
          animation: wiz-in-fwd 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
        }
        .wizard-card[data-dir="back"] {
          animation: wiz-in-back 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
        }
        @keyframes wiz-in-fwd {
          0%   { transform: translateX(48px) translateY(6px) rotate(2.5deg) scale(0.985); opacity: 0; }
          60%  { transform: translateX(-4px) translateY(0)    rotate(-0.4deg) scale(1.003); opacity: 1; }
          100% { transform: translateX(0)    translateY(0)    rotate(0)      scale(1); opacity: 1; }
        }
        @keyframes wiz-in-back {
          0%   { transform: translateX(-48px) translateY(6px) rotate(-2.5deg) scale(0.985); opacity: 0; }
          60%  { transform: translateX(4px)   translateY(0)   rotate(0.4deg)  scale(1.003); opacity: 1; }
          100% { transform: translateX(0)     translateY(0)   rotate(0)       scale(1); opacity: 1; }
        }
        .wizard-sheen {
          pointer-events: none;
          position: absolute;
          inset: 0;
          background: linear-gradient(
            115deg,
            transparent 0%,
            transparent 40%,
            rgba(242, 216, 150, 0.18) 50%,
            transparent 60%,
            transparent 100%
          );
          background-size: 240% 100%;
          background-position: -120% 0;
          animation: wiz-sheen 1100ms cubic-bezier(0.2, 0.7, 0.2, 1) 80ms both;
          border-radius: inherit;
        }
        @keyframes wiz-sheen {
          0%   { background-position: -120% 0; opacity: 0; }
          15%  { opacity: 1; }
          100% { background-position: 220% 0;  opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .wizard-card,
          .wizard-card[data-dir="forward"],
          .wizard-card[data-dir="back"] {
            animation: wiz-in-static 160ms ease both;
          }
          @keyframes wiz-in-static {
            from { opacity: 0; } to { opacity: 1; }
          }
          .wizard-sheen { display: none; }
        }
      `}</style>
    </section>
  );
}

// ── Stage components ────────────────────────────────────────────

function WelcomeStage({
  askForName,
  ownerEmail,
  fullName,
  setFullName,
  onEnter,
}: {
  askForName: boolean;
  ownerEmail: string;
  fullName: string;
  setFullName: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <>
      <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
        Welcome
      </div>
      <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
        🎉 Congratulations on your new business.
      </h1>
      <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
        A few quick questions and Taxottic shapes itself to your
        business — your forecast, deduction matching, state taxes,
        invoicing, the lot. Every answer makes the rest of the app
        smarter for <em>you</em>; nothing here is filed with the IRS,
        and everything is editable later.
      </p>
      <div className="mt-5 grid gap-3 text-xs text-ink-muted">
        <Bullet>
          <strong className="text-forest-900">Name</strong> — so the
          app addresses your business properly across every screen.
        </Bullet>
        <Bullet>
          <strong className="text-forest-900">Structure</strong> —
          drives whether the forecast runs Schedule C, Form 1065, or
          C-Corp math.
        </Bullet>
        <Bullet>
          <strong className="text-forest-900">Home state</strong> —
          unlocks state-tax estimates and the find-a-CPA card.
        </Bullet>
      </div>

      {askForName ? (
        <div className="mt-6 grid gap-2">
          <label className="text-xs uppercase tracking-[0.18em] text-gold-700">
            What should we call you? <span className="text-ink-muted">(optional)</span>
          </label>
          <input
            autoFocus
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onEnter()}
            placeholder={
              ownerEmail
                ? `e.g. ${initialFromEmail(ownerEmail)}`
                : "e.g. Alex Rivera"
            }
            className="input text-base py-2.5"
            maxLength={120}
          />
          <p className="text-[11px] text-ink-muted">
            Goes on your profile — used for greetings and on documents
            shared with your team. Change it any time in
            <code className="px-1">/settings</code>.
          </p>
        </div>
      ) : null}
    </>
  );
}

function NameStage({
  name,
  setName,
  onEnter,
}: {
  name: string;
  setName: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <>
      <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
        Step 1 of 3 · Identity
      </div>
      <h2 className="display mt-2 text-3xl text-forest-900">
        What do you call it?
      </h2>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        Use the working name — what your customers know you as. The
        legal name + EIN can come later in the company profile. This
        is how Taxottic addresses your business throughout the app.
      </p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter()}
        placeholder="e.g. Acme Photography LLC"
        className="input mt-5 text-lg py-3"
        maxLength={120}
      />
    </>
  );
}

function EntityStage({
  entityTypes,
  entityType,
  setEntityType,
}: {
  entityTypes: EntityType[];
  entityType: string;
  setEntityType: (v: string) => void;
}) {
  return (
    <>
      <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
        Step 2 of 3 · Structure
      </div>
      <h2 className="display mt-2 text-3xl text-forest-900">
        How is it organised?
      </h2>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        This drives the math: Schedule&nbsp;C vs. Form&nbsp;1065 vs.
        C-Corp returns, owner-payroll handling, self-employment tax,
        and which deductions surface. Not sure? Go with your gut —
        Taxottic flags anything that looks off later.
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
                  "w-full text-left rounded-xl border px-4 py-3 transition-all " +
                  (checked
                    ? "border-forest-800 bg-forest-800 text-cream shadow-md scale-[1.01]"
                    : "border-forest-100 bg-white/70 text-forest-900 hover:border-forest-300 hover:scale-[1.005]")
                }
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{e.label}</span>
                  {checked ? (
                    <span className="text-[10px] uppercase tracking-wide text-gold-300 ml-auto">
                      ✓ Picked
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
  );
}

function StateStage({
  states,
  stateQuery,
  setStateQuery,
  stateCode,
  setStateCode,
}: {
  states: ReadonlyArray<State>;
  stateQuery: string;
  setStateQuery: (v: string) => void;
  stateCode: string;
  setStateCode: (v: string) => void;
}) {
  return (
    <>
      <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
        Step 3 of 3 · Home base
      </div>
      <h2 className="display mt-2 text-3xl text-forest-900">
        Where is it registered?
      </h2>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        Your home state runs state-income-tax estimates inside the
        forecast and powers the find-a-CPA card. If you have nexus in
        other states (e.g., remote employees), add those later under
        the company profile — we&apos;ll factor them into the forecast too.
      </p>
      <input
        autoFocus
        value={stateQuery}
        onChange={(e) => setStateQuery(e.target.value)}
        placeholder="Search states"
        className="input mt-4"
      />
      <ul className="mt-3 grid gap-1 max-h-64 overflow-y-auto no-scrollbar pr-1">
        {states.map((s) => {
          const checked = stateCode === s.code;
          return (
            <li key={s.code}>
              <button
                type="button"
                onClick={() => setStateCode(s.code)}
                className={
                  "w-full text-left flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-all " +
                  (checked
                    ? "border-forest-800 bg-forest-800 text-cream shadow-md"
                    : "border-forest-100 bg-white/70 text-forest-900 hover:border-forest-300")
                }
              >
                <span>{s.name}</span>
                <span
                  className={
                    "text-[11px] " +
                    (checked ? "text-cream/70" : "text-ink-muted")
                  }
                >
                  {s.code}
                </span>
              </button>
            </li>
          );
        })}
        {states.length === 0 ? (
          <li className="text-xs text-ink-muted text-center py-4">
            No states match.
          </li>
        ) : null}
      </ul>
    </>
  );
}

function ReviewStage({
  name,
  entityLabel,
  stateLabel,
  error,
  submitting,
  onSubmit,
  onEditName,
  onEditEntity,
  onEditState,
}: {
  name: string;
  entityLabel: string;
  stateLabel: string;
  error: string | null;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onEditName: () => void;
  onEditEntity: () => void;
  onEditState: () => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
        Review · One last look
      </div>
      <h2 className="display mt-2 text-3xl text-forest-900">
        Looks right?
      </h2>
      <p className="mt-2 text-sm text-ink-soft">
        Confirm the basics and we&apos;ll spin everything up. You can edit
        any of these later from the company profile.
      </p>
      <ul className="mt-5 grid gap-3">
        <ReviewRow label="Name" value={name} onEdit={onEditName} />
        <ReviewRow
          label="Structure"
          value={entityLabel}
          onEdit={onEditEntity}
        />
        <ReviewRow label="State" value={stateLabel} onEdit={onEditState} />
      </ul>
      <p className="mt-5 text-xs text-ink-muted">
        Next: your personal tax profile (filing status, dependents,
        etc) so the forecast runs correctly.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : null}
      <button
        type="submit"
        className="btn-primary w-full mt-6"
        disabled={submitting}
      >
        {submitting ? "Creating…" : "✨ Create my business"}
      </button>
    </form>
  );
}

function ReviewRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit?: () => void;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-forest-100 pb-3 last:border-0">
      <span className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
        {label}
      </span>
      <span className="flex items-baseline gap-3 min-w-0">
        <span className="text-forest-900 font-medium text-right truncate">
          {value || "-"}
        </span>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="text-[10px] uppercase tracking-[0.18em] text-gold-700 hover:text-forest-900"
          >
            Edit
          </button>
        ) : null}
      </span>
    </li>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className="mt-1 inline-block size-1.5 rounded-full bg-gold-500 shrink-0"
      />
      <span>{children}</span>
    </div>
  );
}

/** Pull a plausible name guess from the user's email local-part:
 *  "alex.rivera@example.com" -> "Alex Rivera". Hint only. */
function initialFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
    .slice(0, 60);
}
