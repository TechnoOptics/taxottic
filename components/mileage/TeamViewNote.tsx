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
export function TeamViewNote({ selfUserId }: { selfUserId: string }) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-forest-200 bg-forest-50 px-4 py-2.5 text-sm text-forest-800">
      <details className="group min-w-0 flex-1">
        {/* min-h-11: this is the control that opens the explanation, and
            it was 20px. The whole note is chrome a manager taps past. */}
        <summary className="flex min-h-11 cursor-pointer select-none list-none items-center gap-2">
          <MapIcon className="size-4 shrink-0" />
          <span className="font-medium">Team view</span>
          <ChevronDownIcon className="size-4 shrink-0 text-forest-600 transition-transform group-open:rotate-180" />
        </summary>
        {/* 188 characters in one block before. Same three facts, one
            fewer word and split, so neither block is a wall. Held under
            170 rendered characters by MilesFirstDrive.ct.spec.tsx. */}
        <p className="mt-2 text-xs leading-relaxed">
          Every driver&apos;s trails in their own colour, numbered to match
          the legend.
        </p>
        <p className="mt-1 text-xs leading-relaxed">
          Teammates show confirmed business drives only, never their
          personal miles. Yours show every classification.
        </p>
      </details>
      <Link
        // No `?range=` any more: the window is a client filter over the
        // drives already loaded, so there is no range for a link to
        // carry. The prop that used to supply one was inert.
        href={`/mileage?driver=${selfUserId}`}
        className="inline-flex min-h-11 items-center underline decoration-dotted whitespace-nowrap hover:text-forest-900"
      >
        My drive log
      </Link>
    </div>
  );
}
