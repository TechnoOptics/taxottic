import { taxYearRunway } from "@/lib/marketing/tax-year-runway";

export type YearSpineProps = {
  taxYear: number;
  asOf: Date;
  variant: "paper" | "panel";
  /** Text at the right of the top row. Defaults to the countdown to the next due date. */
  trailing?: string;
  /** Per-quarter note appended to a tick label, e.g. { 1: "Q1 paid" }. */
  notes?: Partial<Record<1 | 2 | 3 | 4, string>>;
  /** Prefix on the marker label. Omit for the variant's default: "Today" on paper (renders "TODAY · SEP 5"), bare date on panel (renders "SEP 5"). Pass "" to force bare date on either. */
  markerPrefix?: string;
  id?: string;
};

/**
 * The tax-year runway as the spine of a screen: a rail from 1 January to
 * the Q4 due date, ticked at the four federal due dates, filled to a
 * date, with today's marker in brass. Geometry comes from
 * lib/marketing/tax-year-runway.ts, so a tick cannot drift from the
 * statutory date.
 *
 * `--spine-fill` is a CSS variable so YearSpineMotion can move the fill
 * to a section's date as the reader scrolls; the marker stays at today.
 * Brass here is the fill, the marker and its label, nothing else.
 */
export function YearSpine({
  taxYear,
  asOf,
  variant,
  trailing,
  notes,
  markerPrefix,
  id,
}: YearSpineProps) {
  const r = taxYearRunway(taxYear, asOf);
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const last = r.ticks.length - 1;
  const countdown = r.next
    ? `Q${r.next.quarter} due in ${r.daysToNext} days`
    : "All four quarters paid";
  // Paper is the standalone hero signature, so it spells out "Today" on
  // its marker; panel sits inside chrome (the page header) where the
  // marker is already read in context, so it defaults to bare. Either
  // variant can still be overridden by passing markerPrefix explicitly.
  const prefix = markerPrefix ?? (variant === "panel" ? undefined : "Today");
  const marker = prefix ? `${prefix} · ${r.asOfLabel}` : r.asOfLabel;

  return (
    <div
      id={id}
      className={`year-spine year-spine-${variant}`}
      data-fill={r.fill.toFixed(4)}
      style={{ ["--spine-fill" as string]: pct(r.fill) }}
    >
      <div className="year-spine-row mono-label">
        <span>Tax year {taxYear}</span>
        <span>{trailing ?? countdown}</span>
      </div>
      <div className="runway" aria-hidden="true">
        <div className="runway-rail">
          <div className="runway-fill" />
          {r.ticks.map((t) => (
            <div key={t.quarter} className="runway-tick" style={{ left: pct(t.at) }} />
          ))}
          <div className="runway-today" style={{ left: pct(r.fill) }} />
          <span className="runway-today-label" style={{ left: pct(r.fill) }}>
            {marker}
          </span>
        </div>
        <div className="runway-labels">
          {r.ticks.map((t, i) => (
            <span
              key={t.quarter}
              className={i === last ? "-translate-x-full" : "-translate-x-1/2"}
              style={{ left: pct(t.at) }}
            >
              {t.label}
              {notes?.[t.quarter] ? ` · ${notes[t.quarter]}` : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
