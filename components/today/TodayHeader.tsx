/**
 * Spec 4.3 item 1. No greeting: the page's name is the date.
 *
 * Every date on Today is formatted in UTC, here and in the spine, the
 * next-payment panel and the week's ledger. That is deliberate for this
 * PR and it is a known compromise: a user west of UTC late in the evening
 * sees tomorrow's date under a heading that says "Today", and their
 * "seven days" window is shifted by their offset. UTC is what the tax
 * engine, the statutory due dates and every stored timestamp already use,
 * so rendering in it keeps the spine's ticks and the quarter countdown
 * consistent with the numbers beside them, and it keeps the server
 * component deterministic. The follow-up is to render these dates in the
 * viewer's own zone, which needs the zone on the server (a cookie or a
 * profile column) rather than a client-side re-render, and to move the
 * week's window with it.
 */
export function TodayHeader({ asOf, taxYear, syncedAt }: { asOf: Date; taxYear: number; syncedAt?: Date | null }) {
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(asOf);
  const synced = syncedAt ? relative(asOf.getTime() - syncedAt.getTime()) : null;
  return (
    <header className="today-header">
      <h1 className="display today-title">Today</h1>
      <p className="mono-label today-meta">
        <span className="figure">{date}</span>
        <span aria-hidden="true"> · </span>
        <span>Tax year <span className="figure">{taxYear}</span></span>
        {synced ? (
          <>
            <span aria-hidden="true"> · </span>
            <span>Synced <span className="figure">{synced}</span></span>
          </>
        ) : null}
      </p>
    </header>
  );
}

function relative(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
