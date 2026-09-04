import { formatCents } from "@/lib/tax/engine/money";
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";

/**
 * The instrument on the marketing hero's first screen: where the reader
 * sits in the tax year, and what that means in dollars.
 *
 * This is the Instrument skin's signature, the tax-year runway, which
 * app/globals.css defined and nothing rendered. It is not ornament: the
 * rail is ticked at the four federal estimated-tax due dates and filled to
 * a date, so it encodes the one fact this product exists to keep in front
 * of people.
 *
 * Tokens, not hex. The wrapper carries `data-skin="instrument"` with
 * `data-theme="dark"`, a selector globals.css already defines, so every
 * token inside (surface, hairline, brass, figures) takes the skin's dark
 * value. The brass on this screen is spent here and only here: the fill,
 * today's marker, and the one live figure.
 *
 * The figures and the date are a labelled sample, the same convention the
 * product tour uses lower on the page. The date is fixed rather than read
 * from the clock so the visual baselines stay still.
 */
export function HeroInstrument({
  taxYear,
  asOf,
  nextPaymentCents,
  setAsideCents,
}: {
  taxYear: number;
  asOf: Date;
  nextPaymentCents: number;
  setAsideCents: number;
}) {
  const r = taxYearRunway(taxYear, asOf);
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const last = r.ticks.length - 1;

  return (
    <div className="skin-scope" data-skin="instrument" data-theme="dark">
      <div className="card p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <div className="kicker-sm">Tax year {taxYear}</div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted">
            Sample
          </div>
        </div>

        <div className="runway mt-10 mb-9" aria-hidden="true">
          <div className="runway-rail">
            <div className="runway-fill" style={{ width: pct(r.fill) }} />
            {r.ticks.map((t) => (
              <div
                key={t.quarter}
                className="runway-tick"
                style={{ left: pct(t.at) }}
              />
            ))}
            <div className="runway-today" style={{ left: pct(r.fill) }} />
            <span
              className="figure absolute -top-6 -translate-x-1/2 whitespace-nowrap text-[11px] text-accent-2"
              style={{ left: pct(r.fill) }}
            >
              {r.asOfLabel}
            </span>
          </div>
          <div className="relative mt-3 h-4 text-[11px] text-muted">
            {r.ticks.map((t, i) => (
              <span
                key={t.quarter}
                className={
                  "figure absolute whitespace-nowrap " +
                  (i === last ? "-translate-x-full" : "-translate-x-1/2")
                }
                style={{ left: pct(t.at) }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>

        <dl className="grid gap-4">
          <div className="flex items-end justify-between gap-4 border-t border-edge pt-4">
            <div>
              <dt className="text-sm text-foreground">Next payment</dt>
              <dd className="mt-0.5 text-[11px] text-muted">
                {r.next
                  ? `Q${r.next.quarter} · due ${r.next.label} · ${r.daysToNext} days`
                  : "All four quarters paid"}
              </dd>
            </div>
            <dd className="figure text-2xl sm:text-3xl text-accent-2">
              {formatCents(nextPaymentCents)}
            </dd>
          </div>
          <div className="flex items-end justify-between gap-4 border-t border-edge pt-4">
            <dt className="text-sm text-foreground">Set aside so far</dt>
            <dd className="figure text-xl text-foreground">
              {formatCents(setAsideCents)}
            </dd>
          </div>
        </dl>

        <p className="mt-5 text-[11px] leading-relaxed text-muted">
          Federal + state, in step with your bank.
        </p>
      </div>
    </div>
  );
}
