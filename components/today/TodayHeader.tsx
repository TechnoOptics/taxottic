/** Spec 4.3 item 1. No greeting: the page's name is the date. */
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
