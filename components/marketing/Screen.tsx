// components/marketing/Screen.tsx
import type { ReactNode } from "react";

/**
 * A real product screen, drawn with the app's own row shapes and sample
 * data. This replaces the mock "Company X · LIVE" windows: no fake
 * chrome, no status pills, the product's rows as the product sets them.
 */
export function Screen({
  title,
  status,
  children,
}: {
  title: string;
  /**
   * The right-hand slot of the title bar. ReactNode because a status can
   * carry a figure; the bar itself is `mono-label`, so a plain string is
   * already in the data face and only a mixed line needs its own spans.
   */
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="screen">
      <div className="screen-bar mono-label">
        <span>{title}</span>
        {status ? <span>{status}</span> : null}
      </div>
      <div className="screen-body">{children}</div>
    </div>
  );
}

export function StatRow({
  label,
  note,
  value,
  brass = false,
}: {
  label: string;
  /** ReactNode: a note that names a date or an amount wraps it in `figure`. */
  note?: ReactNode;
  value: string;
  brass?: boolean;
}) {
  return (
    <div className="stat-row">
      <div>
        <div className="stat-row-label">{label}</div>
        {note ? <div className="stat-row-note">{note}</div> : null}
      </div>
      <div className={"figure stat-row-value" + (brass ? " stat-row-value-brass" : "")}>{value}</div>
    </div>
  );
}

export function LedgerRow({
  date,
  text,
  note,
  amount,
  tag,
  tagTone = "quiet",
}: {
  date?: string;
  text: string;
  /** ReactNode: a note that names a date or an amount wraps it in `figure`. */
  note?: ReactNode;
  amount: string;
  tag?: string;
  tagTone?: "quiet" | "ask";
}) {
  return (
    <div className={"ledger-row" + (date ? "" : " ledger-row-undated")}>
      {date ? <span className="figure ledger-date">{date}</span> : null}
      <span className="ledger-text">
        {text}
        {note ? <span className="ledger-note">{note}</span> : null}
      </span>
      <span className="figure ledger-amount">{amount}</span>
      {tag ? <span className={"tag" + (tagTone === "ask" ? " tag-ask" : "")}>{tag}</span> : null}
    </div>
  );
}

export function CategoryBar({
  label,
  fraction,
  amount,
}: {
  label: string;
  fraction: number;
  amount: string;
}) {
  const width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  return (
    <div className="cat-row">
      <span>{label}</span>
      <span className="bar" aria-hidden="true">
        <i style={{ width }} />
      </span>
      <span className="figure cat-amount">{amount}</span>
    </div>
  );
}

/**
 * A drive on the app's dark basemap, brass path, start and end discs.
 *
 * The basemap is the navy band, so the marks on it are read against navy
 * and have to take the skin's dark token values: the same
 * data-skin/data-theme scope HeroInstrument puts around its panel. Without
 * it `--accent-2` resolved to the paper brass (#c0973f) on a navy ground.
 * `.skin-scope` is display:contents, so it adds no box and moves nothing.
 * Pinned by Screen.ct.spec.tsx.
 */
export function MiniMap() {
  return (
    <div className="skin-scope" data-skin="instrument" data-theme="dark">
      <div className="mini-map" aria-hidden="true">
        <svg viewBox="0 0 400 150" preserveAspectRatio="none">
          <g stroke="rgba(242,245,248,0.08)">
            <path d="M0 40h400M0 80h400M0 120h400M80 0v150M160 0v150M240 0v150M320 0v150" />
          </g>
          <path
            d="M20 120 C 90 110, 120 60, 190 70 S 300 40, 380 30"
            stroke="var(--accent-2)"
            strokeWidth="2.5"
            fill="none"
          />
          <circle cx="20" cy="120" r="3.5" fill="#f2f5f8" />
          <circle cx="380" cy="30" r="3.5" fill="var(--accent-2)" />
        </svg>
      </div>
    </div>
  );
}
