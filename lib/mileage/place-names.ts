/**
 * Turning a trip's saved-place id into a name the reader recognises.
 *
 * `mileage_trips` stores `start_place_id` and `end_place_id` and no
 * coordinates of its own, so this is the ONLY way a drive row can say
 * where it went without waiting on a polyline and a reverse geocoder.
 * That makes it the single point where a row gets its name, which is why
 * it lives here with a unit test rather than inline in a page: it had
 * three separate implementations (the drive log, the drives route, the
 * business view), two of which resolved the same id through differently
 * written fallbacks. A divergence there is silent and reads to the user
 * as "no data yet", which is this feature's whole failure mode.
 *
 * Resolution is always SERVER side. The client is handed a name, not a
 * lookup table, so the first page of drives and the pages appended after
 * it cannot disagree about what a place is called.
 */

/** The kinds a saved place can be. Mirrors MapPlace["kind"]; the unit
 *  test asserts the two stay assignable in both directions. */
export type PlaceKind = "home" | "office" | "client" | "other";

/** A row of `mileage_places`, reduced to what naming needs. */
export type PlaceRow = {
  id: string;
  kind: PlaceKind;
  label?: string | null;
  lat: number;
  lng: number;
};

/** What a drive row carries for one of its ends. The coordinates come
 *  along because the endpoint line uses them when the other end has to
 *  be reverse-geocoded. */
export type SavedPlace = { label: string; lat: number; lng: number };

/**
 * The name to show for a place the user never named.
 *
 * A switch with an exhaustive `never` check rather than an object
 * lookup: a new kind added to {@link PlaceKind} then fails to compile
 * here instead of silently falling through to "Stop".
 */
export function defaultPlaceLabel(kind: PlaceKind): string {
  switch (kind) {
    case "home":
      return "Home";
    case "office":
      return "Office";
    case "client":
      return "Client";
    case "other":
      return "Stop";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** Index a company's places by id, once per request. */
export function indexPlaces(
  places: readonly PlaceRow[],
): Map<string, SavedPlace> {
  return new Map(
    places.map((p) => [
      p.id,
      {
        label: p.label?.trim() || defaultPlaceLabel(p.kind),
        lat: p.lat,
        lng: p.lng,
      },
    ]),
  );
}

/**
 * The place an id names, or null.
 *
 * Null for a missing id and null for an id this index does not hold, and
 * deliberately the same answer for both: a place from another company,
 * or one deleted since the drive was recorded, must produce NO name
 * rather than a wrong one.
 */
export function savedPlace(
  index: ReadonlyMap<string, SavedPlace>,
  id: string | null | undefined,
): SavedPlace | null {
  if (!id) return null;
  return index.get(id) ?? null;
}

/** Both ends of a drive at once, the shape a drive row renders with. */
export function tripPlaces(
  index: ReadonlyMap<string, SavedPlace>,
  trip: { start_place_id?: string | null; end_place_id?: string | null },
): { startPlace: SavedPlace | null; endPlace: SavedPlace | null } {
  return {
    startPlace: savedPlace(index, trip.start_place_id),
    endPlace: savedPlace(index, trip.end_place_id),
  };
}
