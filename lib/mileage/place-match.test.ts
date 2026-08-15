import { describe, expect, it } from "vitest";
import {
  DEFAULT_RADIUS_M,
  MAX_MATCH_RADIUS_M,
  metresBetween,
  placeForPoint,
  placesForTrip,
  type MatchablePlace,
} from "./place-match";

/**
 * 185 trips since 2026-06-01, every one with a null start_place_id and
 * a null end_place_id, because nothing ever wrote them. This is the
 * matcher that fills them.
 *
 * The fixtures are the real learned places from a production driver, so
 * the distances are the ones this actually has to get right rather than
 * round numbers chosen to make the test pass.
 */

// Real learned places, Minneapolis area.
const HOME: MatchablePlace = { id: "home", lat: 44.7617, lng: -93.4731, radius_m: 150 };
const WORK: MatchablePlace = { id: "work", lat: 44.9785, lng: -93.5082, radius_m: 150 };
const STOP_A: MatchablePlace = { id: "stopA", lat: 44.9714, lng: -93.4963, radius_m: 200 };
const STOP_B: MatchablePlace = { id: "stopB", lat: 44.9691, lng: -93.4386, radius_m: 250 };
const PLACES = [HOME, WORK, STOP_A, STOP_B];

describe("distance", () => {
  it("measures a known separation", () => {
    // Home to work is about 24 km.
    const m = metresBetween(HOME.lat, HOME.lng, WORK.lat, WORK.lng);
    expect(m).toBeGreaterThan(23_000);
    expect(m).toBeLessThan(26_000);
  });

  it("is zero for the same point", () => {
    expect(metresBetween(44.9785, -93.5082, 44.9785, -93.5082)).toBe(0);
  });
});

describe("matching a point to a place", () => {
  it("matches the exact production coordinate that was left unlabelled", () => {
    // The last point recorded before the outage, 34 m from "work".
    expect(placeForPoint(44.9786, -93.5078, PLACES)).toBe("work");
  });

  it("matches home", () => {
    expect(placeForPoint(44.7617, -93.4731, PLACES)).toBe("home");
  });

  it("returns null in open country rather than guessing the nearest", () => {
    // THE POINT OF THE RADIUS RULE. Nearest-match would call this
    // "home" and put a false endpoint on a tax record.
    expect(placeForPoint(45.5, -94.5, PLACES)).toBeNull();
  });

  it("returns null just outside the radius", () => {
    // ~300 m north of work, radius 150.
    expect(placeForPoint(44.9812, -93.5082, PLACES)).toBeNull();
  });

  it("matches just inside the radius", () => {
    // ~100 m north of work.
    expect(placeForPoint(44.9794, -93.5082, PLACES)).toBe("work");
  });

  it("prefers the smaller radius when two places overlap", () => {
    const broad: MatchablePlace = { id: "broad", lat: 44.9785, lng: -93.5082, radius_m: 800 };
    // The point sits inside both; the precise place is the better claim.
    expect(placeForPoint(44.9786, -93.5081, [broad, WORK])).toBe("work");
    expect(placeForPoint(44.9786, -93.5081, [WORK, broad])).toBe("work");
  });
});

describe("bad data does not produce a bad label", () => {
  it("uses the default radius when one is missing", () => {
    const noRadius: MatchablePlace = { id: "x", lat: 44.9785, lng: -93.5082 };
    expect(placeForPoint(44.9786, -93.5081, [noRadius])).toBe("x");
    expect(DEFAULT_RADIUS_M).toBe(150);
  });

  it("ignores a null or nonsense radius rather than trusting it", () => {
    const weird: MatchablePlace = { id: "x", lat: 44.9785, lng: -93.5082, radius_m: 0 };
    expect(placeForPoint(44.9786, -93.5081, [weird])).toBe("x");
    const negative: MatchablePlace = { id: "y", lat: 44.9785, lng: -93.5082, radius_m: -50 };
    expect(placeForPoint(44.9786, -93.5081, [negative])).toBe("y");
  });

  it("caps an absurd radius so one place cannot swallow the county", () => {
    const huge: MatchablePlace = { id: "huge", lat: 44.9785, lng: -93.5082, radius_m: 50_000 };
    // Home is 24 km away, well inside a 50 km radius but outside the cap.
    expect(placeForPoint(HOME.lat, HOME.lng, [huge])).toBeNull();
    expect(MAX_MATCH_RADIUS_M).toBe(1_000);
  });

  it("skips places with unusable coordinates", () => {
    const broken = { id: "b", lat: NaN, lng: -93.5, radius_m: 150 } as MatchablePlace;
    expect(placeForPoint(44.9786, -93.5081, [broken])).toBeNull();
  });

  it("returns null for an unusable point", () => {
    expect(placeForPoint(NaN, -93.5, PLACES)).toBeNull();
  });

  it("handles a driver with no learned places at all", () => {
    expect(placeForPoint(44.9786, -93.5081, [])).toBeNull();
  });
});

describe("labelling a whole trip", () => {
  it("labels the commute in both directions", () => {
    const out = placesForTrip(
      { lat: 44.7617, lng: -93.4731 },
      { lat: 44.9786, lng: -93.5078 },
      PLACES,
    );
    expect(out).toEqual({ start_place_id: "home", end_place_id: "work" });

    const back = placesForTrip(
      { lat: 44.9786, lng: -93.5078 },
      { lat: 44.7617, lng: -93.4731 },
      PLACES,
    );
    expect(back).toEqual({ start_place_id: "work", end_place_id: "home" });
  });

  it("labels one end when only one is known", () => {
    // Left home, ended somewhere new. Half a label beats none: this is
    // what makes "they left home and never came back" answerable.
    expect(
      placesForTrip(
        { lat: 44.7617, lng: -93.4731 },
        { lat: 45.9, lng: -94.9 },
        PLACES,
      ),
    ).toEqual({ start_place_id: "home", end_place_id: null });
  });

  it("labels a round trip that starts and ends at the same place", () => {
    const out = placesForTrip(
      { lat: 44.7617, lng: -93.4731 },
      { lat: 44.7618, lng: -93.4732 },
      PLACES,
    );
    expect(out).toEqual({ start_place_id: "home", end_place_id: "home" });
  });

  it("leaves both null rather than inventing endpoints", () => {
    expect(
      placesForTrip({ lat: 46.1, lng: -95.2 }, { lat: 46.3, lng: -95.4 }, PLACES),
    ).toEqual({ start_place_id: null, end_place_id: null });
  });
});
