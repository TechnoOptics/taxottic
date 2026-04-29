/**
 * Photoreal-leaning medal renderer. The previous version still read a
 * little flat / sticker-like; this revision adds:
 *
 *   - A CONIC gradient highlight band that rolls around the disc the
 *     way light catches a polished bezel. Real metal isn't lit from
 *     one point; the curvature spreads the catch-light into an arc.
 *   - A guilloche pattern: 36 fine radial spokes plus three concentric
 *     hairline rings. Engine-turned guilloche is what makes a fine
 *     watch dial or coin face look "made," not printed.
 *   - A two-pass beveled rim - outer light/dark gradient AND an inner
 *     reverse gradient sliver - so the rim has a visible cross-section.
 *   - A starburst halo behind the engraving for depth in the field.
 *   - A genuine engraved emblem: the symbol is composited with an
 *     SVG inner-shadow filter so each stroke looks carved INTO the
 *     surface, not painted on top.
 *   - Knurled coin edge with 64 teeth (was 48), and the teeth are
 *     drawn as tapered triangles, not rectangles, so they catch the
 *     same light direction as the rim above.
 *   - A drop shadow under the whole assembly.
 *
 * Locked medals use a darker patina palette so the engraving still
 * reads, then we drop the conic highlight and starburst so the locked
 * medal looks "untouched" rather than gray-washed.
 */

import { BADGES, type Badge } from "@/lib/badges/catalog";

type Props = {
  code: string;
  earned?: boolean;
  size?: number;
};

type TierPalette = {
  highlight: string;
  mid: string;
  shadow: string;
  specular: string;
  reflection: string;
  ribbonLight: string;
  ribbonMid: string;
  ribbonDark: string;
  patina: string;
  patinaShadow: string;
};

const TIER: Record<Badge["tier"], TierPalette> = {
  bronze: {
    highlight: "#fad9a3",
    mid: "#b87a3d",
    shadow: "#4a2a08",
    specular: "#fff3da",
    reflection: "#d99356",
    ribbonLight: "#a36436",
    ribbonMid: "#7e4f1e",
    ribbonDark: "#3a2008",
    patina: "#5a432c",
    patinaShadow: "#26180a",
  },
  silver: {
    highlight: "#ffffff",
    mid: "#bcc3ca",
    shadow: "#3b3f44",
    specular: "#ffffff",
    reflection: "#e2e6ea",
    ribbonLight: "#7d848b",
    ribbonMid: "#5c6166",
    ribbonDark: "#1f2226",
    patina: "#4f555c",
    patinaShadow: "#1d2024",
  },
  gold: {
    highlight: "#fff8d6",
    mid: "#d4a64a",
    shadow: "#52340c",
    specular: "#fffdf2",
    reflection: "#f2d896",
    ribbonLight: "#9c7a2c",
    ribbonMid: "#6a4612",
    ribbonDark: "#2a1a02",
    patina: "#5d4a23",
    patinaShadow: "#2a2008",
  },
};

export function BadgeMedal({ code, earned = false, size = 48 }: Props) {
  const badge = BADGES[code];
  if (!badge) return null;
  const tier = TIER[badge.tier];
  const symbol = SYMBOLS[code] ?? SYMBOLS.default;

  const uid = `${badge.tier}-${code}`;
  const id = (suffix: string) => `medal-${uid}-${suffix}`;

  // Locked: keep the engraving readable but drop the lit-from-above
  // shine. We swap to a darker, lower-saturation palette that looks
  // like a tarnished, un-polished coin.
  const face = earned
    ? {
        highlight: tier.highlight,
        mid: tier.mid,
        shadow: tier.shadow,
        specular: tier.specular,
        reflection: tier.reflection,
      }
    : {
        highlight: "#7c8088",
        mid: tier.patina,
        shadow: tier.patinaShadow,
        specular: "rgba(255,255,255,0.18)",
        reflection: "rgba(255,255,255,0.05)",
      };

  // Geometry. 96x120 viewBox: ribbon at top, medallion centered around
  // (cx, cy) with radius r. Inner emblem renders inside a "die" of
  // radius rDie so we leave room for the guilloche ring and rim.
  const cx = 48;
  const cy = 70;
  const r = 32;
  const rGuilloche = r - 2.6;
  const rDie = r - 8.8;

  // Knurled outer edge: 64 tapered triangular teeth. Each tooth fans
  // outward from a base point on the rim to a tip slightly farther out;
  // we also widen the base so neighboring teeth touch and read as a
  // continuous milled edge rather than a row of dots.
  const TOOTH_COUNT = 64;
  const teeth = Array.from({ length: TOOTH_COUNT }, (_, i) => {
    const a = (i / TOOTH_COUNT) * Math.PI * 2;
    const aPrev = a - Math.PI / TOOTH_COUNT;
    const aNext = a + Math.PI / TOOTH_COUNT;
    const baseR = r + 0.6;
    const tipR = r + 2.7;
    const x1 = cx + Math.cos(aPrev) * baseR;
    const y1 = cy + Math.sin(aPrev) * baseR;
    const x2 = cx + Math.cos(a) * tipR;
    const y2 = cy + Math.sin(a) * tipR;
    const x3 = cx + Math.cos(aNext) * baseR;
    const y3 = cy + Math.sin(aNext) * baseR;
    // Top half catches more light, bottom half is in shadow. Smooth
    // sinusoid based on angle so neighboring teeth blend together.
    const tone = 0.5 + 0.5 * Math.cos(a + Math.PI / 2);
    const fill = `rgba(0,0,0,${0.65 - tone * 0.5})`;
    return (
      <polygon
        key={i}
        points={`${x1},${y1} ${x2},${y2} ${x3},${y3}`}
        fill={fill}
      />
    );
  });

  // Guilloche radial spokes: 36 thin lines from rDie to rGuilloche,
  // alternating very faint dark/light strokes. This is what gives a
  // "machined" feel; without it the face looks like a flat sticker.
  const SPOKE_COUNT = 36;
  const spokes = Array.from({ length: SPOKE_COUNT }, (_, i) => {
    const a = (i / SPOKE_COUNT) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * (rDie + 0.4);
    const y1 = cy + Math.sin(a) * (rDie + 0.4);
    const x2 = cx + Math.cos(a) * (rGuilloche - 0.4);
    const y2 = cy + Math.sin(a) * (rGuilloche - 0.4);
    return (
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={i % 2 === 0 ? "rgba(0,0,0,0.32)" : "rgba(255,255,255,0.18)"}
        strokeWidth="0.4"
      />
    );
  });

  return (
    <svg
      viewBox="0 0 96 120"
      width={size}
      height={(size * 120) / 96}
      role="img"
      aria-label={badge.title}
      style={{ overflow: "visible" }}
    >
      <defs>
        {/* Drop shadow under the whole medal */}
        <filter
          id={id("shadow")}
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" />
          <feOffset dx="0" dy="1.6" result="offset" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.5" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Inner-shadow filter: makes engraved strokes look carved INTO
            the surface. Source-alpha -> blur -> offset -> composite-out
            to keep just the inner shadow region. */}
        <filter
          id={id("engrave")}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="b" />
          <feOffset in="b" dx="0.4" dy="0.6" result="o" />
          <feFlood floodColor="#000" floodOpacity="0.7" />
          <feComposite in2="o" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="shadow" />
          </feMerge>
        </filter>

        {/* Face fill: 4-stop radial that suggests a rolled bevel. */}
        <radialGradient
          id={id("face")}
          cx="38%"
          cy="32%"
          r="78%"
          fx="36%"
          fy="28%"
        >
          <stop offset="0%" stopColor={face.highlight} />
          <stop offset="42%" stopColor={face.mid} />
          <stop offset="82%" stopColor={face.mid} />
          <stop offset="100%" stopColor={face.shadow} />
        </radialGradient>

        {/* Hot specular: tight near-white highlight in the upper-left.
            Real polished metal has a sharper hot-spot than plastic. */}
        <radialGradient
          id={id("specular")}
          cx="34%"
          cy="22%"
          r="28%"
          fx="32%"
          fy="18%"
        >
          <stop offset="0%" stopColor={face.specular} stopOpacity="0.95" />
          <stop offset="50%" stopColor={face.specular} stopOpacity="0.18" />
          <stop offset="100%" stopColor={face.specular} stopOpacity="0" />
        </radialGradient>

        {/* Conic-rolling highlight: a long arc of light around the upper
            edge of the disc, tapering off on each side. This is what
            distinguishes "real metal" from "vector circle" - the
            highlight follows the curvature of the rim. */}
        <radialGradient
          id={id("rim-light")}
          cx="50%"
          cy="0%"
          r="80%"
          fx="50%"
          fy="-10%"
        >
          <stop offset="0%" stopColor={face.specular} stopOpacity="0.55" />
          <stop offset="35%" stopColor={face.highlight} stopOpacity="0.25" />
          <stop offset="70%" stopColor={face.highlight} stopOpacity="0" />
        </radialGradient>

        {/* Reflected light from below: cooler, broader. */}
        <radialGradient
          id={id("reflection")}
          cx="68%"
          cy="86%"
          r="48%"
          fx="68%"
          fy="92%"
        >
          <stop offset="0%" stopColor={face.reflection} stopOpacity="0.6" />
          <stop offset="100%" stopColor={face.reflection} stopOpacity="0" />
        </radialGradient>

        {/* Outer beveled rim: top-light, bottom-dark */}
        <linearGradient id={id("rim")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.65)" />
        </linearGradient>

        {/* Inner ring: opposite direction so it reads as a carved groove */}
        <linearGradient id={id("groove")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,0,0,0.7)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.4)" />
        </linearGradient>

        {/* Starburst halo behind the engraving: subtle radial fade that
            lifts the emblem off the field. */}
        <radialGradient
          id={id("halo")}
          cx="50%"
          cy="50%"
          r="50%"
        >
          <stop offset="0%" stopColor={face.highlight} stopOpacity="0.45" />
          <stop offset="55%" stopColor={face.highlight} stopOpacity="0.12" />
          <stop offset="100%" stopColor={face.shadow} stopOpacity="0" />
        </radialGradient>

        {/* Ribbon: vertical gradient gives a fabric sheen */}
        <linearGradient id={id("ribbon")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tier.ribbonLight} />
          <stop offset="50%" stopColor={tier.ribbonMid} />
          <stop offset="100%" stopColor={tier.ribbonDark} />
        </linearGradient>

        {/* Ribbon weave pattern: diagonal cross-hatch suggesting silk */}
        <pattern
          id={id("ribbon-weave")}
          patternUnits="userSpaceOnUse"
          width="3"
          height="3"
        >
          <path
            d="M0,3 L3,0"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="0.4"
          />
          <path
            d="M-1,1 L1,-1 M2,4 L4,2"
            stroke="rgba(0,0,0,0.06)"
            strokeWidth="0.4"
          />
        </pattern>

        {/* Clasp bar gradient: same metal as the medal, top-light */}
        <linearGradient id={id("clasp")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={face.highlight} />
          <stop offset="50%" stopColor={face.mid} />
          <stop offset="100%" stopColor={face.shadow} />
        </linearGradient>
      </defs>

      <g filter={`url(#${id("shadow")})`}>
        {/* RIBBON ---------------------------------------------------- */}
        <path
          d={`M 28 4 L 68 4 L 60 56 L 36 56 Z`}
          fill={`url(#${id("ribbon")})`}
          opacity={earned ? 1 : 0.7}
        />
        <path
          d={`M 28 4 L 68 4 L 60 56 L 36 56 Z`}
          fill={`url(#${id("ribbon-weave")})`}
          opacity={earned ? 1 : 0.5}
        />
        {/* Center fold seam */}
        <path
          d={`M 48 4 L 48 56`}
          stroke="rgba(0,0,0,0.4)"
          strokeWidth="1.2"
        />
        {/* Side highlight pleats */}
        <path
          d={`M 33 4 L 39 4 L 38 56 L 36 56 Z`}
          fill="rgba(255,255,255,0.18)"
        />
        <path
          d={`M 57 4 L 63 4 L 60 56 L 58 56 Z`}
          fill="rgba(0,0,0,0.22)"
        />
        {/* Top-cut V notch */}
        <path
          d={`M 28 4 L 48 14 L 68 4`}
          fill="rgba(0,0,0,0.22)"
        />

        {/* CLASP BAR ------------------------------------------------- */}
        <rect
          x="32"
          y="46"
          width="32"
          height="9"
          rx="1.5"
          fill={`url(#${id("clasp")})`}
        />
        <line
          x1="33"
          y1="49"
          x2="63"
          y2="49"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="0.4"
        />
        <line
          x1="33"
          y1="52"
          x2="63"
          y2="52"
          stroke="rgba(0,0,0,0.45)"
          strokeWidth="0.4"
        />

        {/* MEDALLION ------------------------------------------------- */}
        {/* Knurled coin-edge teeth */}
        <g>{teeth}</g>

        {/* Outer thin shadow ring to cap the teeth and define the rim */}
        <circle
          cx={cx}
          cy={cy}
          r={r + 0.5}
          fill="none"
          stroke="rgba(0,0,0,0.65)"
          strokeWidth="0.8"
        />

        {/* Main face fill */}
        <circle cx={cx} cy={cy} r={r} fill={`url(#${id("face")})`} />

        {/* Reflected light from the table, lower-right */}
        <circle cx={cx} cy={cy} r={r} fill={`url(#${id("reflection")})`} />

        {/* Conic-rolling highlight that wraps the upper rim */}
        {earned ? (
          <circle cx={cx} cy={cy} r={r} fill={`url(#${id("rim-light")})`} />
        ) : null}

        {/* Hot specular point, upper-left */}
        <circle cx={cx} cy={cy} r={r} fill={`url(#${id("specular")})`} />

        {/* Beveled outer rim */}
        <circle
          cx={cx}
          cy={cy}
          r={r - 0.4}
          fill="none"
          stroke={`url(#${id("rim")})`}
          strokeWidth="1.6"
        />
        {/* Inner sliver of the bevel: reverse direction so the rim
            cross-section reads correctly. */}
        <circle
          cx={cx}
          cy={cy}
          r={r - 1.7}
          fill="none"
          stroke={`url(#${id("groove")})`}
          strokeWidth="0.7"
          opacity="0.6"
        />

        {/* Guilloche ring: spokes + concentric hairlines */}
        <g>{spokes}</g>
        <circle
          cx={cx}
          cy={cy}
          r={rGuilloche}
          fill="none"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth="0.6"
        />
        <circle
          cx={cx}
          cy={cy}
          r={rGuilloche - 0.9}
          fill="none"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="0.4"
        />
        <circle
          cx={cx}
          cy={cy}
          r={rDie + 0.4}
          fill="none"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth="0.6"
        />

        {/* Halo behind the emblem to give the field depth */}
        <circle
          cx={cx}
          cy={cy}
          r={rDie}
          fill={`url(#${id("halo")})`}
        />

        {/* ENGRAVED EMBLEM ------------------------------------------ */}
        {/* Three-pass engraving: dark drop, light catch, main stroke
            wrapped in the inner-shadow filter so each line reads as
            carved into the surface. */}
        <g
          transform={`translate(${cx + 0.5} ${cy + 0.6})`}
          stroke={face.shadow}
          strokeOpacity="0.95"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          {symbol}
        </g>
        <g
          transform={`translate(${cx - 0.5} ${cy - 0.5})`}
          stroke={face.highlight}
          strokeOpacity={earned ? 0.85 : 0.5}
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          {symbol}
        </g>
        <g
          transform={`translate(${cx} ${cy})`}
          stroke={face.shadow}
          strokeOpacity="0.95"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          filter={`url(#${id("engrave")})`}
        >
          {symbol}
        </g>
      </g>
    </svg>
  );
}

// Each symbol is rendered centered on (0,0). Designed to fit within an inner
// circle of radius ~14. All paths share a consistent line weight for a
// cohesive set.
const SYMBOLS: Record<string, React.ReactNode> = {
  // Founder - small column / pillar building
  first_company: (
    <>
      <path d="M-8 6 L8 6" />
      <path d="M-7 6 L-7 -4" />
      <path d="M-3 6 L-3 -4" />
      <path d="M3 6 L3 -4" />
      <path d="M7 6 L7 -4" />
      <path d="M-9 -4 L9 -4" />
      <path d="M-7 -4 L0 -10 L7 -4" />
    </>
  ),
  // Forecaster - rising chart
  first_forecast_setup: (
    <>
      <path d="M-9 7 L9 7" />
      <path d="M-9 7 L-9 -8" />
      <path d="M-7 4 L-3 -1 L1 2 L7 -6" />
      <circle cx="7" cy="-6" r="1.4" />
    </>
  ),
  // First income - dollar sign in circle
  first_income: (
    <>
      <circle cx="0" cy="0" r="9" />
      <path d="M0 -7 L0 7" />
      <path d="M3 -4 C3 -6 -3 -6 -3 -3 C-3 0 3 0 3 3 C3 6 -3 6 -3 4" />
    </>
  ),
  // First expense - receipt
  first_expense: (
    <>
      <path d="M-6 -8 L6 -8 L6 8 L4 6 L2 8 L0 6 L-2 8 L-4 6 L-6 8 Z" />
      <path d="M-3 -4 L3 -4" />
      <path d="M-3 -1 L3 -1" />
      <path d="M-3 2 L3 2" />
    </>
  ),
  // Steady (six months data) - laurel wreath / sprig
  six_months_data: (
    <>
      <path d="M0 9 C-6 5 -8 0 -7 -6" />
      <path d="M0 9 C6 5 8 0 7 -6" />
      <path d="M-6 4 C-8 4 -9 2 -9 0" />
      <path d="M-5 -1 C-7 -1 -8 -3 -7 -5" />
      <path d="M6 4 C8 4 9 2 9 0" />
      <path d="M5 -1 C7 -1 8 -3 7 -5" />
      <path d="M0 9 L0 -8" />
    </>
  ),
  // Goal setter - target with bullseye
  goal_setter: (
    <>
      <circle cx="0" cy="0" r="9" />
      <circle cx="0" cy="0" r="5" />
      <circle cx="0" cy="0" r="1.5" />
    </>
  ),
  // Goal crusher - trophy cup
  goal_crusher: (
    <>
      <path d="M-6 -7 L6 -7 L6 -2 C6 2 3 5 0 5 C-3 5 -6 2 -6 -2 Z" />
      <path d="M-6 -5 C-9 -5 -9 -1 -6 -1" />
      <path d="M6 -5 C9 -5 9 -1 6 -1" />
      <path d="M-3 5 L-3 8" />
      <path d="M3 5 L3 8" />
      <path d="M-5 8 L5 8" />
      <path d="M-2 0 L0 2 L2 0" />
    </>
  ),
  // Bella curious - quill/feather
  bella_curious: (
    <>
      <path d="M-6 8 C-4 0 0 -4 6 -8" />
      <path d="M6 -8 L8 -6" />
      <path d="M-2 -1 L4 -1" />
      <path d="M-4 3 L2 3" />
      <path d="M-6 8 L-8 8" />
    </>
  ),
  // Home base - house
  home_office: (
    <>
      <path d="M-9 0 L0 -9 L9 0" />
      <path d="M-7 -1 L-7 8 L7 8 L7 -1" />
      <path d="M-2 8 L-2 2 L2 2 L2 8" />
    </>
  ),
  // On the road - vehicle
  vehicle: (
    <>
      <path d="M-9 2 L-7 -3 L7 -3 L9 2 L9 5 L-9 5 Z" />
      <circle cx="-5" cy="6" r="2" />
      <circle cx="5" cy="6" r="2" />
      <path d="M-5 -3 L-3 -7 L3 -7 L5 -3" />
    </>
  ),
  // Team grower - linked figures
  team_grower: (
    <>
      <circle cx="-4" cy="-4" r="3" />
      <path d="M-9 7 C-9 3 -7 1 -4 1 C-1 1 1 3 1 7" />
      <circle cx="4" cy="-2" r="2.5" />
      <path d="M0 7 C0 4 2 3 4 3 C6 3 9 4 9 7" />
    </>
  ),
  default: (
    <>
      <circle cx="0" cy="0" r="6" />
      <path d="M-3 2 L0 -3 L3 2" />
    </>
  ),
};
