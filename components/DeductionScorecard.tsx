import Link from "next/link";
import { formatCents } from "@/lib/tax/forecast";
import type { Scorecard } from "@/lib/deductions/eligibility";

type Props = {
  publicId: string;
  scorecard: Scorecard;
};

export function DeductionScorecard({ publicId, scorecard }: Props) {
  const captured = scorecard.items.filter((i) => i.captured);
  const remaining = scorecard.items.filter((i) => !i.captured);

  return (
    <section className="card mt-6 p-6 sm:p-7">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Deduction scorecard
          </div>
          <h2 className="display mt-1 text-2xl text-forest-900">
            {scorecard.milestone === "legend"
              ? "Legend status. You are using your tax code."
              : "Every captured deduction lowers what you owe."}
          </h2>
        </div>
        <ScoreBadge milestone={scorecard.milestone} pct={scorecard.scorePct} />
      </div>

      {/* Progress bar with milestone ticks */}
      <div className="mt-5">
        <div className="relative h-3 rounded-full bg-forest-50 overflow-hidden">
          <div
            className="h-full"
            style={{
              width: `${scorecard.scorePct}%`,
              background:
                "linear-gradient(90deg, #c79532 0%, #f2d896 50%, #8a661f 100%)",
            }}
          />
        </div>
        <div className="mt-2 text-xs text-ink-muted flex items-center justify-between">
          <span>
            {scorecard.capturedCount} of {scorecard.totalCount} eligible
            deductions captured
          </span>
          {scorecard.nextMilestone ? (
            <span>
              Next: <strong className="text-forest-800">
                {scorecard.nextMilestone.label}
              </strong>{" "}
              at {scorecard.nextMilestone.pct}%
            </span>
          ) : (
            <span className="text-gold-700 font-medium">Top tier reached.</span>
          )}
        </div>
      </div>

      {/* Captured (top) */}
      {captured.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Captured ({captured.length})
          </h3>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {captured.map((it) => (
              <li
                key={it.code}
                className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-3 text-sm"
              >
                <Checkmark />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-forest-900 leading-tight">
                    {it.label}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {formatCents(it.capturedCents)} this year
                    {it.scheduleC ? ` - ${it.scheduleC}` : ""}
                  </div>
                  <IrsCitation item={it} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Remaining (the journey ahead) */}
      {remaining.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Still on the table ({remaining.length})
          </h3>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {remaining.map((it) => (
              <li
                key={it.code}
                className="flex items-start gap-3 rounded-xl border border-forest-100 bg-white/70 px-3.5 py-3 text-sm"
              >
                <EmptyCircle />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-forest-900 leading-tight">
                    {it.label}
                  </div>
                  <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                    {it.reason}
                    {it.scheduleC ? ` (${it.scheduleC})` : ""}
                  </div>
                  <IrsCitation item={it} />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <Link href={`/c/${publicId}/expenses`} className="btn-primary">
              Log a captured expense
            </Link>
            <span className="text-xs text-ink-muted">
              Each dollar in an eligible category counts that category captured.
            </span>
          </div>
        </div>
      ) : null}

      <p className="mt-6 text-[11px] leading-relaxed text-ink-muted">
        The scorecard cites the Internal Revenue Code section and the
        relevant IRS Publication chapter for each item. It is a guide, not
        legal advice. Many deductions have eligibility rules - confirm with
        a CPA for high-impact items.
      </p>
    </section>
  );
}

function ScoreBadge({
  milestone,
  pct,
}: {
  milestone: Scorecard["milestone"];
  pct: number;
}) {
  const labels: Record<Scorecard["milestone"], string> = {
    starter: "Starter",
    explorer: "Explorer",
    captain: "Captain",
    maestro: "Maestro",
    legend: "Legend",
  };
  return (
    <div className="text-right">
      <div className="display text-3xl sm:text-4xl text-forest-900 leading-none">
        {pct}
        <span className="text-xl">%</span>
      </div>
      <div className="mt-1 inline-flex items-center px-2.5 py-1 rounded-full text-[10px] uppercase tracking-[0.2em] text-gold-700 border border-gold-300/60 bg-gold-50">
        {labels[milestone]}
      </div>
    </div>
  );
}

function IrsCitation({
  item,
}: {
  item: {
    ircSection: string | null;
    pubChapter: string | null;
    irsPub: string | null;
    irsUrl: string | null;
  };
}) {
  const irc = item.ircSection;
  const pub = item.pubChapter ?? item.irsPub;
  if (!irc && !pub) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-[0.15em]">
      {irc ? (
        <span className="inline-flex items-center rounded border border-forest-200 bg-white px-1.5 py-0.5 text-forest-800">
          <span className="font-medium not-italic">IRC </span>
          <span className="ml-1">{irc.replace(/^§+/, "")}</span>
        </span>
      ) : null}
      {pub ? (
        item.irsUrl ? (
          <a
            href={item.irsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded border border-gold-300/70 bg-gold-50 px-1.5 py-0.5 text-gold-700 hover:bg-gold-100 normal-case tracking-normal"
          >
            <span className="font-medium">{pub}</span>
            <svg
              viewBox="0 0 12 12"
              width="9"
              height="9"
              className="ml-1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 3 H9 V9" />
              <path d="M9 3 L3 9" />
            </svg>
          </a>
        ) : (
          <span className="inline-flex items-center rounded border border-gold-300/70 bg-gold-50 px-1.5 py-0.5 text-gold-700 normal-case tracking-normal">
            {pub}
          </span>
        )
      ) : null}
    </div>
  );
}

function Checkmark() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      fill="none"
      stroke="#0f6b3b"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0"
    >
      <circle cx="8" cy="8" r="7" stroke="#0f6b3b" />
      <path d="M5 8 L7 10 L11 6" />
    </svg>
  );
}

function EmptyCircle() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      fill="none"
      stroke="rgba(15, 45, 36, 0.35)"
      strokeWidth="1.4"
      className="mt-0.5 shrink-0"
    >
      <circle cx="8" cy="8" r="7" />
    </svg>
  );
}
