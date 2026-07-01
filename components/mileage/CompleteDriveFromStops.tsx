"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
// "My phone died mid-drive" recovery.
//
// The GPS tracker is best-effort: a dead battery, a killed background
// process, or a no-signal stretch on a road trip leaves a hole in the
// breadcrumb and the drive never lands. Rather than lose the deduction,
// the driver reconstructs the drive here by entering WHERE they went —
// start, destination, and any stops along the way. We geocode each stop
// (Google Places) and compute the DRIVING distance + route with the
// Directions service (real road miles, not straight-line), then hand it
// to the addRouteTrip server action.
//
// Honesty: the computed miles are shown in an EDITABLE field (the driver
// can reconcile against their odometer), the trip lands "unclassified"
// until reviewed, and the note records that it was reconstructed. If the
// Directions service is unavailable we fall back to a straight-line
// estimate from the picked coordinates and say so — it can only
// under-count, never inflate.

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/maps/google-maps-loader";

type Stop = { id: string; label: string; lat: number | null; lng: number | null };
type Computed = {
  miles: number;
  method: "directions" | "straight_line";
  path: { lat: number; lng: number }[];
  summary: string;
};

let STOP_SEQ = 0;
const newStop = (): Stop => ({
  id: `s${STOP_SEQ++}`,
  label: "",
  lat: null,
  lng: null,
});

function datetimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const METERS_PER_MILE = 1609.344;

function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// One stop input, Places-autocomplete enhanced. Reports the resolved label +
// geometry up on selection; on raw typing it reports the text with null
// coords (Directions can still geocode a typed address string).
function StopRow({
  stop,
  index,
  isLast,
  removable,
  onChange,
  onRemove,
}: {
  stop: Stop;
  index: number;
  isLast: boolean;
  removable: boolean;
  onChange: (patch: Partial<Stop>) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let listener: any = null;
    loadGoogleMaps()
      .then((maps: any) => {
        if (cancelled || !ref.current || !maps?.places?.Autocomplete) return;
        const ac = new maps.places.Autocomplete(ref.current, {
          fields: ["formatted_address", "geometry", "name"],
          componentRestrictions: { country: ["us"] },
        });
        listener = ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          const lat = place?.geometry?.location?.lat?.();
          const lng = place?.geometry?.location?.lng?.();
          const label =
            place?.formatted_address ?? place?.name ?? ref.current?.value ?? "";
          if (ref.current && label) ref.current.value = label;
          onChange({
            label,
            lat: typeof lat === "number" ? lat : null,
            lng: typeof lng === "number" ? lng : null,
          });
        });
      })
      .catch(() => {
        /* no key / blocked — stays a plain text input, Directions geocodes it */
      });
    return () => {
      cancelled = true;
      try {
        listener?.remove?.();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = index === 0 ? "Start" : isLast ? "Destination" : `Stop ${index}`;
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.16em] text-gold-700">
          {label}
        </span>
        {removable ? (
          <button
            type="button"
            onClick={onRemove}
            className="text-[11px] text-ink-muted hover:text-rose-700"
          >
            Remove
          </button>
        ) : null}
      </div>
      <input
        ref={ref}
        type="text"
        defaultValue={stop.label}
        onChange={(e) =>
          onChange({ label: e.target.value, lat: null, lng: null })
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        placeholder={
          index === 0
            ? "e.g. 100 Main St, Eagan, MN"
            : isLast
              ? "Where the drive ended"
              : "A place you stopped"
        }
        autoComplete="off"
        className="input"
      />
    </div>
  );
}

export function CompleteDriveFromStops({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [stops, setStops] = useState<Stop[]>(() => [newStop(), newStop()]);
  const [computing, setComputing] = useState(false);
  const [computed, setComputed] = useState<Computed | null>(null);
  const [milesEdit, setMilesEdit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const now = new Date();
  const [startVal] = useState(
    datetimeLocal(new Date(now.getTime() - 60 * 60_000)),
  );
  const [endVal] = useState(datetimeLocal(now));

  const patchStop = (id: string, patch: Partial<Stop>) =>
    setStops((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
  const addStop = () =>
    // Insert before the destination so new "stops along the way" land in the
    // middle of the route, not after the destination.
    setStops((prev) => [...prev.slice(0, -1), newStop(), prev[prev.length - 1]]);
  const removeStop = (id: string) =>
    setStops((prev) => (prev.length > 2 ? prev.filter((s) => s.id !== id) : prev));

  const reset = () => {
    setStops([newStop(), newStop()]);
    setComputed(null);
    setMilesEdit("");
    setError(null);
  };

  const calculate = async () => {
    setError(null);
    setComputed(null);
    const filled = stops.filter((s) => s.label.trim().length > 0);
    if (filled.length < 2) {
      setError("Enter at least a start and a destination.");
      return;
    }
    setComputing(true);
    try {
      const maps: any = await loadGoogleMaps();
      const origin = filled[0];
      const destination = filled[filled.length - 1];
      const middle = filled.slice(1, -1);
      const asPoint = (s: Stop) =>
        s.lat != null && s.lng != null
          ? new maps.LatLng(s.lat, s.lng)
          : s.label;

      const result: Computed | null = await new Promise((resolve) => {
        try {
          const svc = new maps.DirectionsService();
          svc.route(
            {
              origin: asPoint(origin),
              destination: asPoint(destination),
              waypoints: middle.map((s) => ({
                location: asPoint(s),
                stopover: true,
              })),
              travelMode: maps.TravelMode?.DRIVING ?? "DRIVING",
              optimizeWaypoints: false,
            },
            (res: any, status: string) => {
              if (status === "OK" && res?.routes?.[0]) {
                const route = res.routes[0];
                const meters = (route.legs ?? []).reduce(
                  (a: number, leg: any) => a + (leg.distance?.value ?? 0),
                  0,
                );
                // Downsample the polyline so we store a light path.
                const raw = route.overview_path ?? [];
                const step = Math.max(1, Math.ceil(raw.length / 200));
                const path = raw
                  .filter((_: any, i: number) => i % step === 0)
                  .map((p: any) => ({ lat: p.lat(), lng: p.lng() }));
                resolve({
                  miles: meters / METERS_PER_MILE,
                  method: "directions",
                  path,
                  summary: filled.map((s) => s.label).join(" → "),
                });
              } else {
                resolve(null);
              }
            },
          );
        } catch {
          resolve(null);
        }
      });

      if (result) {
        setComputed(result);
        setMilesEdit(result.miles.toFixed(1));
      } else {
        // Directions unavailable — straight-line fallback needs coordinates
        // from picked suggestions.
        const coords = filled
          .filter((s) => s.lat != null && s.lng != null)
          .map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
        if (coords.length < 2) {
          setError(
            "Couldn't calculate the route. Pick each place from the dropdown suggestions so we have its location, then try again.",
          );
          return;
        }
        let miles = 0;
        for (let i = 1; i < coords.length; i++)
          miles += haversineMiles(coords[i - 1], coords[i]);
        setComputed({
          miles,
          method: "straight_line",
          path: coords,
          summary: filled.map((s) => s.label).join(" → "),
        });
        setMilesEdit(miles.toFixed(1));
      }
    } finally {
      setComputing(false);
    }
  };

  const save = async (formData: FormData) => {
    if (!computed) return;
    const miles = Number(milesEdit);
    if (!Number.isFinite(miles) || miles <= 0) {
      setError("Enter a valid mileage.");
      return;
    }
    setSubmitting(true);
    setError(null);
    formData.set("tz_offset_min", String(new Date().getTimezoneOffset()));
    formData.set("distance_miles", String(miles));
    formData.set("method", computed.method);
    formData.set("stops_summary", computed.summary);
    formData.set("path", JSON.stringify(computed.path));
    try {
      await action(formData);
      setOpen(false);
      reset();
    } catch (err) {
      setError((err as Error)?.message ?? "Couldn't save the drive.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 text-xs text-forest-700 hover:text-forest-900 underline underline-offset-2"
        >
          <span aria-hidden="true">🧭</span>
          Phone died on a drive? Rebuild it from where you went
        </button>
      </div>
    );
  }

  return (
    <form action={save} className="mt-3 card p-4 grid gap-3" aria-label="Reconstruct a drive">
      <div className="flex items-center justify-between gap-2">
        <h3 className="display text-base text-forest-900">
          Rebuild a drive from your route
        </h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-xs text-ink-muted hover:text-forest-900"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-ink-muted leading-relaxed">
        For drives the tracker missed (phone died, no signal, app killed).
        Enter where you started, where you ended, and any stops in between —
        we&apos;ll calculate the driving distance for you. Start typing and
        pick from the suggestions for the most accurate result.
      </p>

      {/* Stops */}
      <div className="grid gap-2.5">
        {stops.map((s, i) => (
          <StopRow
            key={s.id}
            stop={s}
            index={i}
            isLast={i === stops.length - 1}
            removable={stops.length > 2 && i !== 0 && i !== stops.length - 1}
            onChange={(patch) => {
              patchStop(s.id, patch);
              setComputed(null);
            }}
            onRemove={() => {
              removeStop(s.id);
              setComputed(null);
            }}
          />
        ))}
        <button
          type="button"
          onClick={addStop}
          className="justify-self-start text-[11px] text-forest-700 hover:text-forest-900 underline underline-offset-2"
        >
          ＋ Add a stop along the way
        </button>
      </div>

      <button
        type="button"
        onClick={calculate}
        disabled={computing}
        className="btn-ghost h-10 text-sm disabled:opacity-60"
      >
        {computing ? "Calculating…" : "Calculate distance"}
      </button>

      {/* Result */}
      {computed ? (
        <div className="grid gap-3 rounded-lg border border-forest-100 bg-cream/40 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-gold-700">
              {computed.method === "directions"
                ? "Road distance"
                : "Straight-line estimate"}
            </span>
            <span className="text-[11px] text-ink-muted truncate max-w-[60%]" title={computed.summary}>
              {computed.summary}
            </span>
          </div>
          <label className="grid gap-1 text-xs text-forest-800">
            Miles (edit to match your odometer if needed)
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="9999"
              value={milesEdit}
              onChange={(e) => setMilesEdit(e.target.value)}
              className="input"
            />
          </label>
          {computed.method === "straight_line" ? (
            <p className="text-[10px] text-ink-muted leading-snug">
              Directions weren&apos;t available, so this is the straight-line
              distance between your stops — it under-counts real road miles.
              Adjust upward to match your actual drive.
            </p>
          ) : null}

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs text-forest-800">
              Start
              <input
                type="datetime-local"
                name="started_at_local"
                defaultValue={startVal}
                required
                className="input"
              />
            </label>
            <label className="grid gap-1 text-xs text-forest-800">
              End
              <input
                type="datetime-local"
                name="ended_at_local"
                defaultValue={endVal}
                required
                className="input"
              />
            </label>
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-xs text-forest-800">Classification</legend>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { v: "business", label: "Business" },
                  { v: "personal", label: "Personal" },
                  { v: "unclassified", label: "Review later" },
                ] as const
              ).map((opt, i) => (
                <label
                  key={opt.v}
                  className="text-xs text-forest-800 cursor-pointer rounded-md border border-forest-200 px-2 h-10 grid place-items-center has-checked:bg-forest-900 has-checked:text-cream has-checked:border-forest-900 transition-colors"
                >
                  <input
                    type="radio"
                    name="classification"
                    value={opt.v}
                    defaultChecked={i === 0}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary h-10 text-sm disabled:opacity-60"
          >
            {submitting ? "Saving…" : `Save this ${milesEdit || "—"}-mile drive`}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}
    </form>
  );
}
