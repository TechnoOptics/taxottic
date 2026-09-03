import Link from "next/link";
import { ChevronDownIcon, MapIcon } from "@/components/ui/Icons";

/**
 * The note a manager sees above the team overlay: what the overlay
 * shows, what teammates keep private, and the way back to their own log.
 *
 * One line until tapped. The explanation says the same thing on every
 * visit, and on a Fold cover screen it ran to five lines that, with the
 * device alert above it, pushed every control and the map below the
 * fold. The prose is unchanged and one tap away; the link to the
 * manager's own log stays outside the fold because it is the only way
 * back from the team view that does not go through the picker.
 *
 * No client storage and no "show once": a native <details> is correct
 * on first paint with nothing to hydrate, and the first visit is the one
 * where the explanation is wanted anyway.
 */
export function TeamViewNote({
  range,
  selfUserId,
}: {
  range: string;
  selfUserId: string;
}) {
  return (
    <div className="mt-3 flex items-start gap-3 rounded-xl border border-forest-200 bg-forest-50 px-4 py-2.5 text-sm text-forest-800">
      <details className="group min-w-0 flex-1">
        <summary className="flex cursor-pointer select-none list-none items-center gap-2">
          <MapIcon className="size-4 shrink-0" />
          <span className="font-medium">Team view</span>
          <ChevronDownIcon className="size-4 shrink-0 text-forest-600 transition-transform group-open:rotate-180" />
        </summary>
        <p className="mt-2 text-xs leading-relaxed">
          Every driver&apos;s trails in their own colour, numbered to match
          the legend. Teammates show confirmed business drives only, never
          their personal miles. Your own drives show every classification.
        </p>
      </details>
      <Link
        href={`/mileage?range=${range}&driver=${selfUserId}`}
        className="underline decoration-dotted whitespace-nowrap hover:text-forest-900"
      >
        My drive log →
      </Link>
    </div>
  );
}
