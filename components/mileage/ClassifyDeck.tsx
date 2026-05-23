"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PendingTrip } from "@/app/mileage/classify/page";

type Props = {
  pending: PendingTrip[];
  action: (formData: FormData) => Promise<void>;
};

const SWIPE_THRESHOLD = 80;

/**
 * Phone-side equivalent of the watch's Confirm screen.
 *
 * One trip at a time, full-width card with two big tap targets
 * (Business / Personal). The card also accepts a horizontal swipe
 * gesture — left = Business (matches watch left-Business
 * convention), right = Personal — for users who naturally pull off
 * the watch's muscle memory. Drag adjusts translateX + rotation so
 * the swipe feels physical; release past threshold commits, before
 * snaps back.
 *
 * Vibrates twice on first mount (one-shot) so a user who opens the
 * page from a push notification gets the same "this is your turn"
 * cue the watch fires.
 */
export function ClassifyDeck({ pending, action }: Props) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [dx, setDx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);
  const buzzedRef = useRef(false);

  // One-shot haptic on mount. Native gives a real buzz via
  // @capacitor/haptics; browsers fall back to navigator.vibrate.
  // Either way, mirrors the wrist UX.
  useEffect(() => {
    if (buzzedRef.current) return;
    buzzedRef.current = true;
    (async () => {
      try {
        const mod = await import("@capacitor/haptics");
        await mod.Haptics.notification({
          type: "WARNING" as unknown as never,
        });
      } catch {
        try {
          if ("vibrate" in navigator) {
            (navigator as Navigator & { vibrate: (p: number[]) => void })
              .vibrate([90, 120, 90]);
          }
        } catch {
          /* no haptics in this context */
        }
      }
    })();
  }, []);

  if (idx >= pending.length) {
    return (
      <div className="mt-10 card p-6 text-center">
        <div className="text-3xl text-gold-500" aria-hidden="true">
          ✓
        </div>
        <div className="display mt-2 text-lg text-forest-900">
          All caught up
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          Every drive is classified.
        </p>
      </div>
    );
  }

  const trip = pending[idx];
  const startedAt = new Date(trip.startedAtISO);
  const endedAt = new Date(trip.endedAtISO);
  const minutes = Math.max(
    1,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000),
  );
  const draggingBusiness = dx < -8;

  const commit = async (classification: "business" | "personal") => {
    if (busy) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("id", trip.id);
    fd.set("classification", classification);
    await action(fd);
    // Move to next card visually; the server revalidates the page,
    // so on a real reload pending would be one shorter.
    setIdx((i) => i + 1);
    setDx(0);
    setBusy(false);
    // If this was the last card, redirect to /mileage so the user
    // doesn't sit on an empty deck.
    if (idx + 1 >= pending.length) {
      router.push("/mileage?caughtup=1");
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current == null) return;
    setDx(e.clientX - startX.current);
  };
  const onPointerUp = () => {
    if (startX.current == null) return;
    const distance = dx;
    startX.current = null;
    setDragging(false);
    if (distance < -SWIPE_THRESHOLD) {
      void commit("business");
    } else if (distance > SWIPE_THRESHOLD) {
      void commit("personal");
    } else {
      setDx(0);
    }
  };

  return (
    <div className="mt-6 select-none">
      <div
        className="relative rounded-3xl border border-forest-100 bg-white p-6 shadow-md touch-pan-y"
        style={{
          transform: `translateX(${dx}px) rotate(${dx / 30}deg)`,
          transition: dragging ? "none" : "transform 200ms ease-out",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
          {startedAt.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
          {" · "}
          {startedAt.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
        <div className="display mt-1 text-3xl text-forest-900">
          {trip.distanceMiles.toFixed(1)} mi
        </div>
        <div className="text-sm text-ink-muted mt-1">
          {minutes} min · est. deduction $
          {(trip.estDeductionCents / 100).toFixed(2)} if business
        </div>
        {Math.abs(dx) > 40 ? (
          <div
            className={
              "mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium " +
              (draggingBusiness
                ? "bg-emerald-50 text-emerald-800"
                : "bg-amber-50 text-amber-800")
            }
          >
            {draggingBusiness ? "← Business" : "Personal →"}
          </div>
        ) : null}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => commit("business")}
            disabled={busy}
            className="rounded-2xl bg-forest-900 text-cream py-3 text-sm font-semibold disabled:opacity-60 active:scale-[0.98] transition-transform"
          >
            Business
          </button>
          <button
            type="button"
            onClick={() => commit("personal")}
            disabled={busy}
            className="rounded-2xl border border-forest-200 bg-white text-forest-900 py-3 text-sm font-semibold disabled:opacity-60 active:scale-[0.98] transition-transform"
          >
            Personal
          </button>
        </div>
        <div className="mt-3 text-[11px] text-ink-muted text-center">
          ← swipe left = Business · swipe right = Personal →
        </div>
      </div>

      {pending.length > 1 ? (
        <div className="mt-3 text-center text-[11px] text-ink-muted">
          {idx + 1} of {pending.length}
        </div>
      ) : null}
    </div>
  );
}
