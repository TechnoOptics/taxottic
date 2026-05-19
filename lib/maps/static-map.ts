// Google Static Maps URL builder — server-safe, zero-JS.
//
// Used for the lightweight trip thumbnails in the mileage list (a
// full interactive <MileageMap> is overkill per row). Pure string
// construction: no google.maps global, so it runs in a server
// component. Returns null when there's no key or too few points so
// the caller renders nothing instead of a broken <img>.
//
// Key handling (security): the SAME public, HTTP-referrer-restricted
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as the JS loader. The Static Maps
// API must be enabled on that key and the referrer allow-list must
// include taxottic.com + the Capacitor WebView origin. The key is
// only ever interpolated into an <img> src the browser requests
// directly — never logged, never committed.

export type StaticMapPoint = { lat: number; lng: number };

type Classification = "business" | "personal" | "unclassified";

// Match the interactive map's breadcrumb palette so a thumbnail and
// the big map read as the same trip.
const PATH_COLOR: Record<Classification, string> = {
  business: "0x16a34a",
  personal: "0xd97706",
  unclassified: "0x71717a",
};

/**
 * Even-stride downsample that always keeps the first and last fix.
 * A Static Maps URL must stay well under the ~16k char limit, and
 * 60-ish points is plenty to read the shape of a drive.
 */
function downsample(
  points: StaticMapPoint[],
  max: number,
): StaticMapPoint[] {
  if (points.length <= max) return points;
  const out: StaticMapPoint[] = [];
  const stride = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round(i * stride)]);
  }
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/**
 * Build a Static Maps URL for a trip's breadcrumb, or null if it
 * can't / shouldn't render (no key, <2 points). `scale:2` keeps it
 * crisp on the retina/AMOLED screens this app targets.
 */
export function staticMapUrl(
  points: StaticMapPoint[],
  opts?: {
    width?: number;
    height?: number;
    classification?: Classification;
  },
): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const pts = (points ?? []).filter(
    (p) =>
      p &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      Math.abs(p.lat) <= 90 &&
      Math.abs(p.lng) <= 180,
  );
  if (pts.length < 2) return null;

  const w = Math.max(32, Math.min(opts?.width ?? 128, 640));
  const h = Math.max(32, Math.min(opts?.height ?? 128, 640));
  const color = PATH_COLOR[opts?.classification ?? "unclassified"];

  const path =
    `color:${color}|weight:3|` +
    downsample(pts, 60)
      .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
      .join("|");

  const qs = new URLSearchParams({
    size: `${w}x${h}`,
    scale: "2",
    maptype: "roadmap",
    path,
    key,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${qs.toString()}`;
}
