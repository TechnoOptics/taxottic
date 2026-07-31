/**
 * Shared outline icon set.
 *
 * Same frame as the rail's own glyphs (components/LeftRail.tsx): 24x24,
 * fill none, stroke `currentColor`, weight 1.6, round caps and joins. The
 * stroke MUST stay `currentColor`: authenticated pages render on the dark
 * navy surface and raw hex in an SVG is not remapped by the theme, so a
 * hardcoded colour goes invisible on one theme or the other.
 *
 * Size is set by the caller through `className` (Tailwind `size-*`) so a
 * glyph can sit inline with text at one size and headline a card at
 * another without a second copy of the path data.
 *
 * These replaced emoji that were previously standing in as icons. Emoji
 * render as vendor-specific colour bitmaps, ignore `currentColor`, and
 * read as consumer-grade next to the rest of the interface.
 */

import type { ReactNode } from "react";

type IconProps = { className?: string };

function Frame({
  children,
  className = "size-5",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Notification bell. Header indicator for outstanding tasks. */
export function BellIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 3.6.8 5.3 1.6 6.2.4.5.1 1.3-.6 1.3H5c-.7 0-1-.8-.6-1.3C5.2 14.8 6 13.1 6 9.5Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </Frame>
  );
}

/** Columned bank building. Marks a synced bank transaction. */
export function BankIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M3 10 12 4l9 6" />
      <path d="M5.5 10v8M9.5 10v8M14.5 10v8M18.5 10v8" />
      <path d="M3 21h18" />
    </Frame>
  );
}

/** Receipt / document. Marks an imported or uploaded transaction. */
export function ReceiptIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M6 4h9l5 5v11a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1zM14 4v5h5M9 13h6M9 17h6" />
    </Frame>
  );
}

/** Car. Marks a drive. Same outline as the rail's Mileage glyph. */
export function CarIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </Frame>
  );
}

/** Compass. "Go explore / go to the map." Matches the rail's Explore glyph. */
export function CompassIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88" />
    </Frame>
  );
}

/** Speech bubble. Matches the rail's Chat glyph. */
export function ChatIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H9l-4 4v-4H6a2 2 0 01-2-2V6z" />
    </Frame>
  );
}

/** Padlock. Marks a feature gated behind a paid plan. */
export function LockIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Frame>
  );
}

/** Folded map. Marks the whole-team map view. */
export function MapIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </Frame>
  );
}

/** Eye. Marks a read-only "you are reviewing someone else" view. */
export function EyeIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Frame>
  );
}

/** Lightning bolt. Marks something quick to clear. */
export function BoltIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M13 3 5 13.5h6L11 21l8-10.5h-6L13 3Z" />
    </Frame>
  );
}

/** Map pin. Marks a saved place or a trip endpoint. */
export function PinIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Frame>
  );
}

/** Alert triangle. Marks a warning the user has to act on. */
export function WarningIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20.3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5V14M12 17h.01" />
    </Frame>
  );
}

/** Circular arrow. Marks freshly synced data. */
export function RefreshIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 4.5V10H15" />
    </Frame>
  );
}

/** Handset. Marks a feature that only exists in the mobile app. */
export function PhoneIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </Frame>
  );
}

/** Calculator keypad. */
export function CalculatorIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <rect x="4.5" y="2.5" width="15" height="19" rx="2.5" />
      <path d="M8 6.5h8" />
      <path d="M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h3.5" />
    </Frame>
  );
}

/** Bar chart. */
export function ChartIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d="M3.5 20.5h17" />
      <path d="M7 20.5v-6M12 20.5V8M17 20.5v-9" />
    </Frame>
  );
}
