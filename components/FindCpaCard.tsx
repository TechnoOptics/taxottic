type Props = {
  zip?: string | null;
  stateCode?: string | null;
  city?: string | null;
};

/**
 * Renders a "find a CPA / tax preparer near you" card. Builds a Google Maps
 * search URL using whatever location the user has shared (zip > city+state >
 * state), so results come back ranked by Google's own review signals. We
 * never call a paid Places API - this stays free for the user, the user, and
 * the budget.
 */
export function FindCpaCard({ zip, stateCode, city }: Props) {
  const locationLabel =
    zip ||
    [city, stateCode].filter(Boolean).join(", ") ||
    stateCode ||
    null;

  const query = `tax preparer CPA accountant${
    locationLabel ? " near " + locationLabel : ""
  }`;
  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(
    query,
  )}`;

  return (
    <div className="card p-6 sm:p-7">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        Need a tax preparer?
      </div>
      <h2 className="display mt-1 text-xl text-forest-900">
        Find a CPA ranked by Google reviews.
      </h2>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">
        Open Google Maps to see top-rated tax preparers
        {locationLabel ? ` near ${locationLabel}` : " near you"}, sorted by
        real reviews from real businesses. Bring your year-end summary and
        you&apos;ll have a productive 30 minutes.
      </p>
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary"
        >
          Open Google Maps results
        </a>
        {!locationLabel ? (
          <span className="text-xs text-ink-muted">
            Add an address or zip in your business profile for nearer matches.
          </span>
        ) : null}
      </div>
    </div>
  );
}
