"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Google Places Autocomplete, as a DROP-IN for a plain street-address
// <input>. It renders the exact same input (same `name`, so the
// server action / form submission is unchanged) and *progressively
// enhances* it once the Maps JS `places` library is available.
//
// Graceful by design (the #69 lesson): no key, offline, or script
// blocked → it stays a normal text field. No error UI, because a
// missing optional enhancement isn't an error to the user.
//
// On selection it also fills the sibling City / ZIP inputs in the
// same <form> (looked up by name) so picking one prediction
// completes the address block in a single tap.

import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "@/lib/maps/google-maps-loader";

function pick(
  components: any[],
  type: string,
  short = false,
): string | null {
  const c = components?.find((x) => x.types?.includes(type));
  if (!c) return null;
  return short ? c.short_name : c.long_name;
}

export function AddressAutocomplete({
  name,
  defaultValue,
  disabled,
  placeholder,
  className,
  cityInputName,
  zipInputName,
  latInputName,
  lngInputName,
}: {
  name: string;
  defaultValue?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** If provided, picking a suggestion writes the city into the form
   *  field with this `name=` AND writes only the street ("123 Main St")
   *  into the main input, the multi-field address pattern. If
   *  omitted, the main input gets the FULL formatted address
   *  ("123 Main St, City, ST 12345") instead, which is what
   *  single-address-field forms (like /mileage/places) want. */
  cityInputName?: string;
  zipInputName?: string;
  /** If provided, picking a suggestion writes the geocoded
   *  lat/lng into hidden inputs with these names. Lets the server
   *  skip an extra geocode round-trip and avoids "not_found" when
   *  the typed text was ambiguous. */
  latInputName?: string;
  lngInputName?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    let listener: any = null;

    loadGoogleMaps()
      .then((maps: any) => {
        if (cancelled || !inputRef.current) return;
        if (!maps?.places?.Autocomplete) return; // older API / no places
        const ac = new maps.places.Autocomplete(inputRef.current, {
          types: ["address"],
          // `geometry` so we can grab the picked lat/lng without a
          // second geocode call. `name` is the place's display name
          // (sometimes useful for POIs). The Maps JS API charges per
          // field group used; geometry is in the "Basic" group with
          // address_components so this stays the same SKU.
          fields: ["address_components", "formatted_address", "geometry"],
          componentRestrictions: { country: ["us"] },
        });
        listener = ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          const comp = place?.address_components ?? [];
          if (!comp.length || !inputRef.current) return;

          // Multi-field mode (a sibling city input is wired up) →
          // street-only into the main input, the rest into the
          // siblings. This is how the firm-onboarding "Business
          // address" block uses this component.
          //
          // Single-field mode (no cityInputName given) → the user
          // expects the full address visible in the one box they
          // see, so use `formatted_address`. This is the
          // /mileage/places case the user reported as broken on
          // May 23 2026, picking a suggestion was overwriting
          // their input with just "1234 Maple St" and losing the
          // city/state/zip.
          if (cityInputName) {
            const streetNo = pick(comp, "street_number") ?? "";
            const route = pick(comp, "route") ?? "";
            const line1 = `${streetNo} ${route}`.trim();
            if (line1) inputRef.current.value = line1;
          } else {
            const full = place?.formatted_address ?? "";
            if (full) inputRef.current.value = full;
          }

          const form = inputRef.current.closest("form");
          if (form) {
            const city =
              pick(comp, "locality") ??
              pick(comp, "sublocality") ??
              pick(comp, "postal_town");
            const zip = pick(comp, "postal_code");
            if (cityInputName && city) {
              const el = form.elements.namedItem(
                cityInputName,
              ) as HTMLInputElement | null;
              if (el) el.value = city;
            }
            if (zipInputName && zip) {
              const el = form.elements.namedItem(
                zipInputName,
              ) as HTMLInputElement | null;
              if (el) el.value = zip;
            }
            // Stash the picked geometry into hidden inputs so the
            // server action can skip geocoding entirely. Falls back
            // to server-side geocode if the user typed an address
            // manually (no place_changed fires for raw typing).
            const lat = place?.geometry?.location?.lat?.();
            const lng = place?.geometry?.location?.lng?.();
            if (latInputName && typeof lat === "number") {
              const el = form.elements.namedItem(
                latInputName,
              ) as HTMLInputElement | null;
              if (el) el.value = String(lat);
            }
            if (lngInputName && typeof lng === "number") {
              const el = form.elements.namedItem(
                lngInputName,
              ) as HTMLInputElement | null;
              if (el) el.value = String(lng);
            }
          }
        });
      })
      .catch(() => {
        /* no key / blocked, stays a plain input */
      });

    return () => {
      cancelled = true;
      try {
        listener?.remove?.();
      } catch {
        /* ignore */
      }
    };
  }, [disabled, cityInputName, zipInputName, latInputName, lngInputName]);

  return (
    <input
      ref={inputRef}
      name={name}
      type="text"
      className={className}
      disabled={disabled}
      defaultValue={defaultValue}
      placeholder={placeholder}
      autoComplete="off"
      // Choosing a prediction with Enter must not submit the form.
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
    />
  );
}
