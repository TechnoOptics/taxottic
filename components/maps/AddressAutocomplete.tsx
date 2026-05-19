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
}: {
  name: string;
  defaultValue?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  cityInputName?: string;
  zipInputName?: string;
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
          fields: ["address_components", "formatted_address"],
          componentRestrictions: { country: ["us"] },
        });
        listener = ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          const comp = place?.address_components ?? [];
          if (!comp.length || !inputRef.current) return;

          const streetNo = pick(comp, "street_number") ?? "";
          const route = pick(comp, "route") ?? "";
          const line1 = `${streetNo} ${route}`.trim();
          if (line1) inputRef.current.value = line1;

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
          }
        });
      })
      .catch(() => {
        /* no key / blocked — stays a plain input */
      });

    return () => {
      cancelled = true;
      try {
        listener?.remove?.();
      } catch {
        /* ignore */
      }
    };
  }, [disabled, cityInputName, zipInputName]);

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
