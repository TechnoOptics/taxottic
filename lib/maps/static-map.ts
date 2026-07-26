// Google Static Maps URL builder, server-safe, zero-JS.
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
// directly, never logged, never committed.

export type StaticMapPoint = { lat: number; lng: number };

type Classification = "business" | "personal" | "unclassified";

// Match the interactive map EXACTLY: same gold/amber breadcrumbs on
// the same dark navy basemap, so a thumbnail and the big map read as
// the same trip. The previous palette (green on Google's default LIGHT
// roadmap at weight 3) was invisible inside the dark app UI — the
// route "could not be seen" at 64 px.
const PATH_COLOR: Record<Classification, string> = {
  business: "0xF2D896", // gold, as MileageMap's TRIP_COLOR.business
  personal: "0xD97706", // amber
  unclassified: "0xA1A1AA",
};

// Static Maps `style` params mirroring MileageMap's dark theme (navy
// geometry, muted labels). Kept minimal: enough for the path to pop
// and the tile to blend with the app's dark cards.
const DARK_STYLE = [
  "feature:all|element:geometry|color:0x1d2843",
  "feature:water|element:geometry|color:0x121a2a",
  "feature:road|element:geometry|color:0x2a3a5e",
  "feature:all|element:labels|visibility:off",
  "feature:poi|visibility:off",
  "feature:transit|visibility:off",
];

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
    `color:${color}|weight:4|` +
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
  // URLSearchParams can't repeat a key via the object form; Static Maps
  // wants one `style` param per rule.
  for (const rule of DARK_STYLE) qs.append("style", rule);
  return `https://maps.googleapis.com/maps/api/staticmap?${qs.toString()}`;
}
