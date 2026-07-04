"use client";

import { useActionState } from "react";
import { AddressAutocomplete } from "@/components/maps/AddressAutocomplete";

type ActionResult = { ok: true } | { ok: false; error: string };

const KINDS: Array<{
  value: "office" | "client" | "home" | "other";
  label: string;
  hint: string;
}> = [
  {
    value: "office",
    label: "Office",
    hint: "Drives that start or end here auto-classify as business.",
  },
  {
    value: "client",
    label: "Client site",
    hint: "Drives that start or end here auto-classify as business.",
  },
  {
    value: "home",
    label: "Home",
    hint: "Trips that start AND end here classify as personal.",
  },
  {
    value: "other",
    label: "Other",
    hint: "Saved place, does not auto-classify on its own.",
  },
];

export function AddPlaceForm({
  addPlaceAction,
}: {
  addPlaceAction: (
    prev: ActionResult | null,
    formData: FormData,
  ) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(addPlaceAction, null);

  return (
    <form action={formAction} className="grid gap-4">
      <div>
        <label
          htmlFor="place-label"
          className="text-xs uppercase tracking-[0.18em] text-gold-700"
        >
          Name
        </label>
        <input
          id="place-label"
          name="label"
          type="text"
          required
          placeholder="HQ, Client X, Home …"
          className="mt-1 w-full rounded-xl border border-forest-100 bg-white px-3 py-2 text-sm text-forest-900 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200"
        />
      </div>

      <fieldset>
        <legend className="text-xs uppercase tracking-[0.18em] text-gold-700">
          Category
        </legend>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {KINDS.map((k, i) => (
            <label
              key={k.value}
              className="flex items-start gap-2 rounded-xl border border-forest-100 bg-white px-3 py-2 cursor-pointer hover:border-gold-300 has-[input:checked]:border-gold-300 has-[input:checked]:ring-1 has-[input:checked]:ring-gold-200"
              title={k.hint}
            >
              <input
                type="radio"
                name="kind"
                value={k.value}
                defaultChecked={i === 0}
                className="mt-0.5 size-4 accent-forest-700"
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-forest-900">
                  {k.label}
                </div>
                <div className="text-[10px] text-ink-muted leading-tight mt-0.5">
                  {k.hint}
                </div>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor="place-address"
          className="text-xs uppercase tracking-[0.18em] text-gold-700"
        >
          Address
        </label>
        {/* AddressAutocomplete: SINGLE-field mode (no cityInputName
            passed) → picking a suggestion now writes the FULL
            formatted address into the input (was previously dropping
            city/state/zip), and stashes the picked lat/lng into the
            hidden inputs below so the server skips the geocode
            round-trip + can't return "not_found". Manual typing
            still works, falls through to server-side geocode. */}
        <AddressAutocomplete
          name="address"
          placeholder="123 Main St, City, ST"
          className="mt-1 w-full rounded-xl border border-forest-100 bg-white px-3 py-2 text-sm text-forest-900 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200"
          latInputName="picked_lat"
          lngInputName="picked_lng"
        />
        {/* Hidden carriers for the picked geometry. Server action
            prefers these when present, falls back to geocoding the
            raw address when the user typed instead of picked. */}
        <input type="hidden" name="picked_lat" defaultValue="" />
        <input type="hidden" name="picked_lng" defaultValue="" />
        <p className="mt-1 text-[11px] text-ink-muted">
          Pick a suggestion to drop a pin instantly, or type any
          address and we&apos;ll geocode it.
        </p>
      </div>

      <div>
        <label
          htmlFor="place-radius"
          className="text-xs uppercase tracking-[0.18em] text-gold-700"
        >
          Geofence radius
        </label>
        <input
          id="place-radius"
          name="radius_m"
          type="number"
          min={20}
          max={5000}
          step={10}
          defaultValue={120}
          className="mt-1 w-32 rounded-xl border border-forest-100 bg-white px-3 py-2 text-sm text-forest-900 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200"
        />
        <span className="ml-2 text-sm text-ink-soft">metres</span>
        <p className="mt-1 text-[11px] text-ink-muted">
          A drive counts as &quot;touching&quot; this place if it starts or ends
          within this radius. 120 m is right for most buildings + parking;
          stretch it for sprawling sites.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary text-sm disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save place"}
        </button>
        {state?.ok === false ? (
          <span className="text-sm text-red-700">{state.error}</span>
        ) : null}
        {state?.ok === true ? (
          <span className="text-sm text-gold-700">Saved.</span>
        ) : null}
      </div>
    </form>
  );
}
