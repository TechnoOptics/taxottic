import type { ReactNode } from "react";

/**
 * Everything between opening Miles and reading a drive.
 *
 * WHAT IT REPLACED. At 390px the head was a breadcrumb, a two-line
 * title, a company line, a tracking alert, a driver selector, a Team
 * view row, a "3 drives need a quick call" card and eight pills in five
 * visual treatments, every one of them 32px tall. It pushed the filter
 * to 769px and the first drive row to 1405px. The owner's words were
 * "messy and not user friendly" and "has too many words in some
 * sections".
 *
 * WHAT IT IS NOW. Three facts, in the order a reader wants them:
 *
 *  1. Whose drives these are, with the switch beside the name when the
 *     viewer can read somebody else's, and a tracking marker ONLY when a
 *     phone needs attention. The marker opens the detail that already
 *     existed; it is not a second copy of it.
 *  2. What they come to: miles and deduction in the data face, with the
 *     number of drives they were computed from.
 *  3. What is waiting, when anything is, as a link to the first drive
 *     that wants a decision.
 *
 * THE CLASSIFICATION QUESTION IS ASKED ONCE. The amber card, the orange
 * pill and the "Need review" stat all asked the same thing, above a list
 * whose every row already carries a business-or-personal control. This
 * head states the count and points at the row; the row is where the
 * decision is made.
 *
 * Presentational on purpose: no state, no data access, no clock. The
 * page hands it the numbers it already computed and the two nodes it
 * already built, which is what lets it mount in a rendered test at the
 * width the complaint came from (MilesHead.ct.spec.tsx).
 */
export function MilesHead({
  who,
  where,
  miles,
  deductionCents,
  driveCount,
  awaiting,
  switcher,
  tracking,
}: {
  /** Whose drives are being read: "Your drives", a teammate's name, or
   *  "All drivers" for the team overlay. */
  who: string;
  /** The business these drives belong to. Quiet, on the same line, so a
   *  driver who belongs to two companies can still tell which log this
   *  is without spending a line on it. */
  where?: string;
  /** Business miles the figures below were computed from. */
  miles: number;
  deductionCents: number;
  /** How many drives are loaded. The figures are settled business
   *  drives; this is the list they were taken from. */
  driveCount: number;
  /** Drives awaiting a decision, across every date. Zero renders
   *  nothing: the rows ask, and a head that says "none waiting" on every
   *  visit is a line that never changes. */
  awaiting: number;
  /** The manager's driver switch, when the viewer has one. */
  switcher?: ReactNode;
  /** The tracking detail, passed ONLY when a phone needs attention. */
  tracking?: ReactNode;
}) {
  return (
    <header className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="display text-xl text-[var(--foreground)]">{who}</h1>
        {where ? <span className="mono-label">{where}</span> : null}
        {switcher ? <div className="min-w-0">{switcher}</div> : null}
        {tracking ? <div className="min-w-0 grow">{tracking}</div> : null}
      </div>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="figure text-2xl text-[var(--foreground)]">
          {fmtMiles(miles)} mi
        </span>
        <span className="figure text-2xl text-[var(--foreground)]">
          {fmtUsd(deductionCents)}
        </span>
        <span className="mono-label">
          {driveCount} {driveCount === 1 ? "drive" : "drives"}
        </span>
      </p>
      {awaiting > 0 ? (
        // Not a banner and not a pill. It says how many and it goes to
        // the first one, which is the only action it could offer that
        // the row does not already offer better.
        <a
          href="#first-unclassified"
          className="mono-label min-h-11 inline-flex items-center self-start underline decoration-dotted underline-offset-4"
        >
          {awaiting} waiting
        </a>
      ) : null}
    </header>
  );
}

function fmtMiles(m: number) {
  return m.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function fmtUsd(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
