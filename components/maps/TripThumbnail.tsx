// A tiny static-map preview for a single trip row. Server component
// (no "use client"): it's just an <img> whose src is built by
// lib/maps/static-map. Renders nothing when there's no key or too
// few GPS fixes, so the mileage list degrades cleanly to text-only
// exactly like it did before Maps was configured.
//
// Plain <img> on purpose — next/image would need a remotePatterns
// entry for maps.googleapis.com (a config + CI surface we don't want
// for a 64px decoration). loading="lazy" keeps long trip lists cheap.

/* eslint-disable @next/next/no-img-element -- deliberate: a static
   Google Maps thumbnail is a sub-100px decoration; next/image would
   force a maps.googleapis.com remotePatterns entry (config + CI
   surface) and an optimizer round-trip for no real LCP benefit. */
import { staticMapUrl, type StaticMapPoint } from "@/lib/maps/static-map";

export function TripThumbnail({
  points,
  classification,
  size = 64,
}: {
  points: StaticMapPoint[];
  classification: "business" | "personal" | "unclassified";
  size?: number;
}) {
  const url = staticMapUrl(points, {
    width: size,
    height: size,
    classification,
  });
  if (!url) return null;
  return (
    <img
      src={url}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      alt=""
      aria-hidden="true"
      className="rounded-lg border border-black/5 object-cover shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
