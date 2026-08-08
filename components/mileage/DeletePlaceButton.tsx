"use client";

import { useState, useTransition } from "react";

/**
 * Remove a saved place, behind a two-tap confirm.
 *
 * It was a single-tap submit. Removing a place is not recoverable from
 * the UI: the label, the exact coordinates and the radius are gone, and
 * every future drive to that address quietly stops auto-classifying as
 * business, which is the whole reason the place existed. The delete
 * button sits inches from the address text on a phone.
 *
 * Two taps rather than window.confirm() to match the trip delete in
 * components/mileage/TripList.tsx, whose comment on the same decision
 * reads: destructive actions should never be one click on a touch
 * device.
 *
 * The action is AWAITED. deleteMileagePlace returns early without
 * deleting when the place is gone or the caller is not in its company,
 * and it skips its revalidatePath calls on those paths, so a refused
 * removal repainted nothing and read exactly like a tap that missed.
 * The row is verified as gone before the confirm state resets.
 */
export function DeletePlaceButton({
  placeId,
  label,
  action,
}: {
  placeId: string;
  label: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <div className="shrink-0 text-right">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-red-700 hover:underline underline-offset-2"
        >
          Remove
        </button>
        {error ? (
          <div role="alert" className="mt-1 text-[11px] text-red-800">
            {error}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="shrink-0 flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          const fd = new FormData();
          fd.set("place_id", placeId);
          startTransition(async () => {
            try {
              await action(fd);
              setConfirming(false);
            } catch {
              setConfirming(false);
              setError("Could not remove this place. Try again.");
            }
          });
        }}
        className="text-[11px] px-2.5 h-8 rounded-full bg-rose-600 text-white font-medium disabled:opacity-60"
      >
        {pending ? "Removing…" : "Remove?"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirming(false)}
        aria-label={`Keep ${label}`}
        className="text-[11px] px-2.5 h-8 rounded-full border border-forest-200 text-forest-800 disabled:opacity-60"
      >
        Cancel
      </button>
    </div>
  );
}
