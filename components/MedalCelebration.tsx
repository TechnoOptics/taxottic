"use client";

import { useEffect, useState } from "react";
import { BADGES, type Badge } from "@/lib/badges/catalog";
import { BadgeMedal } from "./BadgeMedal";

type Props = {
  /** Codes earned in the most recent dashboard render. Each one
   *  pops a celebration card the user can advance through. */
  newlyEarnedCodes: string[];
};

const ENCOURAGEMENT: Record<Badge["tier"], string[]> = {
  bronze: [
    "First step. The compounding starts here.",
    "Quietly impressive.",
    "Keep that pace and the year does the heavy lifting.",
  ],
  silver: [
    "You're not a beginner anymore.",
    "Steady hands win tax season.",
    "Your CPA is going to love you.",
  ],
  gold: [
    "This is what discipline looks like.",
    "Hall-of-fame habits.",
    "You're playing a different game than most.",
  ],
};

/**
 * Stacked celebration overlay. Shows once per newly-awarded badge,
 * auto-disappears as the user dismisses each one. The trigger is
 * server-side: dashboard's evaluateBadges() returns the codes that
 * were just inserted, and on the next render they're already in the
 * badges table so the array is empty - one-shot guaranteed.
 *
 * Visual: full-screen backdrop (not modal), large polished medal,
 * tier label, encouragement line, "Keep going" CTA. Dismiss with
 * Escape or clicking outside the medal card.
 */
export function MedalCelebration({ newlyEarnedCodes }: Props) {
  const [queue, setQueue] = useState<string[]>(newlyEarnedCodes);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Hydration-safe random pick: SSR + first client render both use
  // index 0 (deterministic, same on both sides → no React #418), and
  // a useEffect after mount swaps in a real Math.random pick. The
  // overlay only ever flashes for a frame in the worst case, and
  // only when the user just earned a badge — well worth avoiding
  // the hydration mismatch that took down the forecast page in
  // production. The index is per-badge so consecutive medals don't
  // repeat the same line.
  const [messageIndexByCode, setMessageIndexByCode] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    setReduceMotion(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }, []);

  // After mount, randomize the message index per queued code. Runs
  // every time the queue changes so a fresh dismissal lands on a new
  // line. SSR rendered with empty `messageIndexByCode`, so the
  // server falls through the `?? 0` and the first client render
  // matches. After this effect runs, React commits a new render
  // with a real random index — *post* hydration, which is fine.
  useEffect(() => {
    if (queue.length === 0) return;
    const top = queue[0];
    const badge = BADGES[top];
    if (!badge) return;
    setMessageIndexByCode((prev) =>
      prev[top] != null
        ? prev
        : {
            ...prev,
            [top]: Math.floor(
              Math.random() * ENCOURAGEMENT[badge.tier].length,
            ),
          },
    );
  }, [queue]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setQueue((q) => q.slice(1));
      }
    }
    if (queue.length > 0) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [queue.length]);

  if (queue.length === 0) return null;

  const code = queue[0];
  const badge = BADGES[code];
  if (!badge) return null;

  const messageIndex = messageIndexByCode[code] ?? 0;
  const message = ENCOURAGEMENT[badge.tier][messageIndex];
  const remaining = queue.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`You earned ${badge.title}`}
      className="fixed inset-0 z-[60] grid place-items-center px-4"
      onClick={() => setQueue((q) => q.slice(1))}
    >
      <div className="absolute inset-0 bg-forest-900/60 backdrop-blur-md" />
      {/* Confetti / rays - pure CSS, gated by reduced-motion */}
      {!reduceMotion ? (
        <>
          <div className="medal-rays absolute inset-0 pointer-events-none" />
          <Confetti />
        </>
      ) : null}

      <div
        className="relative max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card p-7 sm:p-9 text-center relative overflow-hidden">
          <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
            Achievement unlocked
          </div>
          <div className="mt-5 grid place-items-center">
            <BadgeMedal code={code} earned size={140} />
          </div>
          <h2 className="display mt-4 text-2xl text-forest-900">
            {badge.title}
          </h2>
          <p className="mt-1 text-[10px] uppercase tracking-[0.28em] text-gold-700">
            {tierLabel(badge.tier)}
          </p>
          <p className="mt-4 text-sm text-ink-soft leading-relaxed">
            {badge.description}
          </p>
          <p className="mt-3 text-sm font-medium text-forest-800 italic">
            &quot;{message}&quot;
          </p>
          <button
            type="button"
            onClick={() => setQueue((q) => q.slice(1))}
            className="btn-primary mt-7 w-full"
            autoFocus
          >
            {remaining > 0 ? `Keep going (${remaining} more)` : "Keep going"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes medal-rays-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .medal-rays {
          background:
            conic-gradient(
              from 0deg at 50% 50%,
              transparent 0deg,
              rgba(213, 187, 126, 0.10) 4deg,
              transparent 8deg,
              transparent 18deg,
              rgba(213, 187, 126, 0.06) 22deg,
              transparent 26deg,
              transparent 36deg
            );
          background-repeat: repeat;
          mask-image: radial-gradient(circle at 50% 50%, black 0%, black 30%, transparent 60%);
          animation: medal-rays-rotate 18s linear infinite;
        }
      `}</style>
    </div>
  );
}

function tierLabel(t: Badge["tier"]): string {
  return t === "bronze" ? "Bronze" : t === "silver" ? "Silver" : "Gold";
}

function Confetti() {
  // 24 small champagne / forest squares falling from the top.
  const pieces = Array.from({ length: 24 }, (_, i) => ({
    left: (i / 24) * 100 + (i % 3) * 2,
    delay: (i % 8) * 0.15,
    duration: 1.6 + (i % 5) * 0.18,
    color:
      i % 3 === 0
        ? "#d5bb7e"
        : i % 3 === 1
          ? "#c4a25d"
          : "#41527d",
    rotation: (i * 47) % 360,
  }));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute top-[-12px] block size-2.5"
          style={{
            left: `${p.left}%`,
            background: p.color,
            transform: `rotate(${p.rotation}deg)`,
            animation: `medal-confetti ${p.duration}s ease-out ${p.delay}s forwards`,
          }}
        />
      ))}
      <style>{`
        @keyframes medal-confetti {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
