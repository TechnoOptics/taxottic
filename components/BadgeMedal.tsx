/**
 * Premium medal/trophy renderer for badges. Each badge code maps to:
 *  - tier (bronze / silver / gold) → ribbon + medallion gradient
 *  - symbol → an SVG glyph drawn inside the medallion
 *
 * Inspired by classical award medals: ribbon at top, circular medallion with
 * a beveled rim, symbolic glyph centered. No emoji, ever.
 */

import { BADGES, type Badge } from "@/lib/badges/catalog";

type Props = {
  code: string;
  earned?: boolean;
  size?: number;
};

const TIER_GRADIENTS: Record<Badge["tier"], { id: string; stops: [string, string, string]; ribbon: string }> = {
  bronze: {
    id: "tx-tier-bronze",
    stops: ["#9b6f3a", "#d99356", "#7e4f1e"],
    ribbon: "#7e4f1e",
  },
  silver: {
    id: "tx-tier-silver",
    stops: ["#9aa1a8", "#e2e6ea", "#7c8389"],
    ribbon: "#5c6166",
  },
  gold: {
    id: "tx-tier-gold",
    stops: ["#8a661f", "#f2d896", "#a78540"],
    ribbon: "#8a661f",
  },
};

export function BadgeMedal({ code, earned = false, size = 48 }: Props) {
  const badge = BADGES[code];
  if (!badge) return null;
  const tier = TIER_GRADIENTS[badge.tier];
  const symbol = SYMBOLS[code] ?? SYMBOLS.default;

  // Unique gradient ID per render so multiple medals don't share a fill.
  const gid = `${tier.id}-${code}`;
  const innerId = `${gid}-inner`;
  const ringId = `${gid}-ring`;

  return (
    <svg
      viewBox="0 0 64 80"
      width={size}
      height={(size * 80) / 64}
      role="img"
      aria-label={badge.title}
      className={earned ? "" : "opacity-30 grayscale"}
    >
      <defs>
        {/* Medallion fill: radial bevel */}
        <radialGradient id={gid} cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor={tier.stops[1]} />
          <stop offset="60%" stopColor={tier.stops[0]} />
          <stop offset="100%" stopColor={tier.stops[2]} />
        </radialGradient>
        {/* Inner emblem fill: subtle highlight */}
        <radialGradient id={innerId} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        {/* Outer rim: thin metallic ring */}
        <linearGradient id={ringId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.7)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.25)" />
        </linearGradient>
      </defs>

      {/* Ribbon (two trapezoids overlapping behind the medallion) */}
      <polygon
        points="20,2 44,2 38,28 26,28"
        fill={tier.ribbon}
        opacity="0.9"
      />
      <polygon
        points="22,2 32,2 30,30 24,30"
        fill="rgba(0,0,0,0.18)"
      />
      <polygon
        points="32,2 42,2 40,30 34,30"
        fill="rgba(255,255,255,0.18)"
      />

      {/* Medallion */}
      <circle cx="32" cy="48" r="22" fill={`url(#${gid})`} />
      {/* Inner highlight */}
      <circle cx="32" cy="48" r="22" fill={`url(#${innerId})`} />
      {/* Beveled outer rim */}
      <circle
        cx="32"
        cy="48"
        r="22"
        fill="none"
        stroke={`url(#${ringId})`}
        strokeWidth="1.5"
      />
      {/* Inner ring detail */}
      <circle
        cx="32"
        cy="48"
        r="17"
        fill="none"
        stroke="rgba(0,0,0,0.25)"
        strokeWidth="0.6"
      />

      {/* Centered symbol glyph */}
      <g transform="translate(32 48)" stroke="rgba(20,20,20,0.85)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {symbol}
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
      <circle cx="7" cy="-6" r="1.4" fill="rgba(20,20,20,0.85)" />
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
      <circle cx="0" cy="0" r="1.5" fill="rgba(20,20,20,0.85)" />
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
      <circle cx="-5" cy="6" r="2" fill="rgba(20,20,20,0.85)" />
      <circle cx="5" cy="6" r="2" fill="rgba(20,20,20,0.85)" />
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
