import Link from "next/link";
import { CheckIcon } from "@/components/ui/Icons";

/**
 * The drive log's standing answer to "is anything waiting on me?".
 *
 * It sits first in the page's control row and it is ALWAYS there, at zero
 * as much as at fifty. That is the point of it: the amber banner below
 * only exists above zero, so a driver could not learn where the review
 * queue lives, and the count that governed the banner was blind to the
 * commonest pending state anyway. A control that appears only when there
 * is bad news teaches nobody where to look.
 *
 * It is deliberately NOT one of the range pills it sits beside, and the
 * hairline after it says so structurally: the range pills change what you
 * are looking at, this one takes you somewhere. It holds its position in
 * both states so it is never hunted for.
 *
 * No dollar figure, in either state. #617 measured seventeen pending
 * drives holding 173.8 miles against $33.89, because the confirmation
 * flag is written alongside a zeroed deduction. Quoting that reads as
 * nineteen cents a mile and understates what confirming them is worth.
 */
export function NeedsDecisionPill({ count }: { count: number }) {
  if (count <= 0) {
    return (
      <span
        role="status"
        className="text-xs px-3 h-8 inline-flex items-center gap-1.5 rounded-full border border-forest-200 text-ink-soft whitespace-nowrap"
      >
        <CheckIcon className="size-3.5 shrink-0 text-emerald-600" />
        No drives waiting
      </span>
    );
  }

  return (
    <Link
      href="/mileage/classify"
      // The one filled pill in a row of outlined ones. The row already
      // carries the page's visual language; making this the single
      // saturated element gives it priority without inventing anything.
      aria-label={`${count} ${count === 1 ? "drive needs" : "drives need"} your call`}
      className="text-xs pl-1.5 pr-3 h-8 inline-flex items-center gap-2 rounded-full bg-amber-600 text-white font-medium whitespace-nowrap hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className="grid place-items-center min-w-5 h-5 px-1 rounded-full bg-white/20 tabular-nums"
      >
        {count}
      </span>
      <span aria-hidden="true">Needs your call →</span>
    </Link>
  );
}
