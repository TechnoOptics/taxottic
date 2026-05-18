// Deterministic monogram avatar shared across the chat surface.

import type { CompanyMember } from "./types";

const PALETTE = [
  { bg: "#1d2843", fg: "#fbf7e9" }, // forest
  { bg: "#5e3812", fg: "#fbf7e9" }, // bronze
  { bg: "#6a4612", fg: "#fbf7e9" }, // gold
  { bg: "#2f3e63", fg: "#fbf7e9" }, // forest-600
  { bg: "#41527d", fg: "#fbf7e9" }, // forest-500
  { bg: "#a78540", fg: "#1d2843" }, // gold-600
];

function pickColor(userId: string) {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

export function displayName(member: CompanyMember | undefined): string {
  if (!member) return "Teammate";
  if (member.full_name) return member.full_name;
  if (member.email) return member.email.split("@")[0];
  return "Teammate";
}

export function Monogram({
  userId,
  member,
  size = 36,
  online,
}: {
  userId: string;
  member: CompanyMember | undefined;
  size?: number;
  online?: boolean;
}) {
  const initial = (member?.full_name ?? member?.email ?? "?")
    .trim()
    .charAt(0)
    .toUpperCase() || "?";
  const palette = pickColor(userId);
  return (
    <span
      className="relative inline-grid place-items-center rounded-full font-semibold shrink-0 select-none"
      style={{
        width: size,
        height: size,
        background: palette.bg,
        color: palette.fg,
        fontSize: Math.max(11, Math.round(size * 0.4)),
      }}
      aria-hidden="true"
    >
      {initial}
      {online ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-white"
        />
      ) : null}
    </span>
  );
}
