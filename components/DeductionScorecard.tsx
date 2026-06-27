import Link from "next/link";
import { formatCents } from "@/lib/tax/forecast";
import type { Scorecard } from "@/lib/deductions/eligibility";
import { getMasterItemsForScorecardCode } from "@/lib/deductions/scorecard-bridge";
import type { MasterDeduction } from "@/lib/deductions/types";

type Props = {
  publicId: string;
  scorecard: Scorecard;
  // When embedded inside another titled card (e.g. a collapsible section on
  // the forecast), drop our own card chrome + the duplicate "Deduction
  // scorecard" kicker so it doesn't nest a card or repeat the title.
  embedded?: boolean;
};

// Cap the number of items rendered per tile so a category with 60+
// rows (Marketing, Office, Software) doesn't dominate the page. The
// rest are one click away in the explorer.
const ITEMS_PREVIEW = 8;

export function DeductionScorecard({
  publicId,
  scorecard,
  embedded = false,
}: Props) {
  const captured = scorecard.items.filter((i) => i.captured);
  const remaining = scorecard.items.filter((i) => !i.captured);

  return (
    <section className={embedded ? "" : "card mt-6 p-6 sm:p-7"}>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          {embedded ? null : (
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Deduction scorecard
            </div>
          )}
          <h2 className="display mt-1 text-2xl text-forest-900">
            {scorecard.milestone === "legend"
              ? "Legend status. You are using your tax code."
              : "Every captured deduction lowers what you owe."}
          </h2>
          {/* Captured totals here are PROJECTED year-end amounts — one-offs
              counted once + recurring rows expanded to full year — so the
              scorecard answers "if you keep this pace, what does year-end
              look like?" rather than "what's logged today?" Flagged
              explicitly so the numbers don't read as a contradiction with
              the YTD figure at the top of the forecast. */}
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-ink-muted">
            Projected year-end totals
          </p>
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
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
            {captured.map((it) => (
              <ScorecardTile
                key={it.code}
                publicId={publicId}
                item={it}
                tone="captured"
              />
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
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
            {remaining.map((it) => (
              <ScorecardTile
                key={it.code}
                publicId={publicId}
                item={it}
                tone="remaining"
              />
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

// Each tile is a native <details>/<summary> pair so tap-to-expand works
// without any client JS. The summary is the original tile content; the
// expanded body lists up to ITEMS_PREVIEW master deductions in this
// scorecard category so the user sees concrete examples of what to
// expense, plus a deep-link to the full explorer.
function ScorecardTile({
  publicId,
  item,
  tone,
}: {
  publicId: string;
  item: import("@/lib/deductions/eligibility").ScorecardItem;
  tone: "captured" | "remaining";
}) {
  const masterItems = getMasterItemsForScorecardCode(item.code);
  const preview = masterItems.slice(0, ITEMS_PREVIEW);
  const overflow = masterItems.length - preview.length;

  const containerClass =
    tone === "captured"
      ? "rounded-xl border border-emerald-200 bg-emerald-50/60"
      : "rounded-xl border border-forest-100 bg-white/70";

  const explorerHref = `/c/${publicId}/deductions?focus=${encodeURIComponent(
    item.label,
  )}`;

  return (
    <li className={`${containerClass} text-sm overflow-hidden`}>
      <details className="group">
        <summary className="list-none cursor-pointer flex items-start gap-3 px-3.5 py-3 select-none hover:bg-cream/40 transition-colors">
          {tone === "captured" ? <Checkmark /> : <EmptyCircle />}
          <div className="min-w-0 flex-1">
            <div className="font-medium text-forest-900 leading-tight">
              {item.label}
            </div>
            <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              {tone === "captured" ? (
                <>
                  {formatCents(item.capturedCents)} this year
                  {item.scheduleC ? ` · ${item.scheduleC}` : ""}
                </>
              ) : (
                <>
                  {item.reason}
                  {item.scheduleC ? ` (${item.scheduleC})` : ""}
                </>
              )}
            </div>
            <IrsCitation item={item} />
          </div>
          <span
            aria-hidden="true"
            className="shrink-0 mt-0.5 size-6 rounded-full bg-forest-50 inline-flex items-center justify-center text-forest-700 transition-transform duration-200 group-open:rotate-180 text-[11px]"
          >
            ▾
          </span>
        </summary>
        {masterItems.length > 0 ? (
          <div className="border-t border-forest-100/60 px-3.5 py-3 bg-white/40">
            <div className="text-[10px] uppercase tracking-[0.18em] text-gold-700 mb-2">
              Examples of what to expense
            </div>
            <ul className="grid gap-1">
              {preview.map((d) => (
                <li
                  key={d.code}
                  className="flex items-baseline justify-between gap-3 text-xs"
                >
                  <span className="text-forest-900 truncate">{d.name}</span>
                  {d.source ? (
                    <a
                      href={d.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-[10px] text-forest-700 hover:text-forest-900 underline underline-offset-2"
                    >
                      IRS ↗
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between gap-3 text-[11px]">
              {overflow > 0 ? (
                <span className="text-ink-muted">+ {overflow} more</span>
              ) : (
                <span className="text-ink-muted">
                  All {masterItems.length} shown
                </span>
              )}
              <Link
                href={explorerHref}
                className="text-forest-700 hover:text-forest-900 underline underline-offset-2"
              >
                Browse all deductions →
              </Link>
            </div>
          </div>
        ) : (
          <div className="border-t border-forest-100/60 px-3.5 py-3 text-[11px] text-ink-muted bg-white/40">
            No specific examples mapped yet - see the{" "}
            <Link
              href={`/c/${publicId}/deductions`}
              className="underline hover:text-forest-900"
            >
              full deductions catalog
            </Link>
            .
          </div>
        )}
      </details>
    </li>
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
      stroke="rgba(29, 40, 67, 0.35)"
      strokeWidth="1.4"
      className="mt-0.5 shrink-0"
    >
      <circle cx="8" cy="8" r="7" />
    </svg>
  );
}
