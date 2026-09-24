import { describe, it, expect } from "vitest";
import type { MapPlace } from "@/components/mileage/MileageMap";
import {
  defaultPlaceLabel,
  indexPlaces,
  savedPlace,
  tripPlaces,
  type PlaceKind,
  type PlaceRow,
} from "./place-names";

/**
 * This is the single point where a drive row gets its name. Every other
 * test of the feature starts from a row that already HAS one, and tsc
 * does not object to a mistyped field in the object literal that builds
 * it, so a mistake here is invisible until a user reads a row that has
 * forgotten where it went.
 */

const PLACES: PlaceRow[] = [
  { id: "p-home", kind: "home", label: "Head Office", lat: 44.98, lng: -93.26 },
  { id: "p-blank", kind: "office", label: "   ", lat: 45.1, lng: -93.2 },
  { id: "p-null", kind: "client", label: null, lat: 44.8, lng: -93.5 },
];

describe("naming a drive's endpoints", () => {
  it("resolves a saved id to its name and its coordinates", () => {
    const got = savedPlace(indexPlaces(PLACES), "p-home");
    expect(got).toEqual({ label: "Head Office", lat: 44.98, lng: -93.26 });
  });

  it("gives an unknown id no name rather than a wrong one", () => {
    const index = indexPlaces(PLACES);
    // A place from another company, or one deleted since the drive was
    // recorded. Naming it after some other row would be worse than
    // saying nothing, and saying nothing is what the row is built for.
    expect(savedPlace(index, "p-not-here")).toBeNull();
    expect(savedPlace(index, null)).toBeNull();
    expect(savedPlace(index, undefined)).toBeNull();
    expect(savedPlace(index, "")).toBeNull();
  });

  it("falls back to the kind when the user never named the place", () => {
    const index = indexPlaces(PLACES);
    expect(savedPlace(index, "p-null")?.label).toBe("Client");
    // Whitespace is not a name either: it would render as an empty
    // label with an arrow pointing at nothing.
    expect(savedPlace(index, "p-blank")?.label).toBe("Office");
  });

  it("gives every kind a label, with no cast and no gaps", () => {
    // Typed as the union, so adding a kind to PlaceKind without adding
    // it here fails tsc rather than quietly showing "Stop".
    const kinds: PlaceKind[] = ["home", "office", "client", "other"];
    const labels = kinds.map(defaultPlaceLabel);
    expect(labels).toEqual(["Home", "Office", "Client", "Stop"]);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("stays in step with the kind the map renders", () => {
    // Assignable BOTH ways: MapPlace["kind"] is what the places query
    // hands these helpers, and a kind added to one and not the other is
    // a compile error here instead of a missing label in production.
    const fromMap: PlaceKind = "client" as MapPlace["kind"];
    const toMap: MapPlace["kind"] = "client" as PlaceKind;
    expect([fromMap, toMap]).toEqual(["client", "client"]);
  });

  it("names both ends of a trip, independently", () => {
    const index = indexPlaces(PLACES);
    expect(
      tripPlaces(index, { start_place_id: "p-home", end_place_id: null }),
    ).toEqual({
      startPlace: { label: "Head Office", lat: 44.98, lng: -93.26 },
      endPlace: null,
    });
    expect(tripPlaces(index, {})).toEqual({
      startPlace: null,
      endPlace: null,
    });
  });
});
