"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Our own "I'm human" check for the browser sign-in form (item 18).
 *
 * A checkbox-style control, like the ones people recognize, but backed by our
 * own server (app/api/human-check). On mount it fetches a signed challenge and
 * starts counting real pointer/touch movement. When the user clicks to verify,
 * it redeems the challenge along with the interaction metrics (elapsed time,
 * movement, trusted event); the server only returns a signed pass if those
 * look human. On success we call onVerified with the pass token.
 *
 * Rendered only in the browser (the caller wraps it in <WebOnly>), so the
 * native app never sees it.
 */
export function HumanCheck({
  onVerified,
}: {
  onVerified: (pass: { pass: string; exp: number; nonce: string }) => void;
}) {
  const [state, setState] = useState<
    "loading" | "ready" | "checking" | "verified" | "error"
  >("loading");
  const [message, setMessage] = useState<string | null>(null);

  const challengeRef = useRef<{ nonce: string; exp: number; sig: string } | null>(
    null,
  );
  const mountedAtRef = useRef<number>(0);
  const movesRef = useRef<number>(0);

  // Fetch a fresh challenge and begin tracking interaction entropy.
  useEffect(() => {
    let cancelled = false;
    const onMove = () => {
      movesRef.current += 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });

    (async () => {
      try {
        const res = await fetch("/api/human-check", { method: "GET" });
        if (!res.ok) throw new Error("issue_failed");
        const ch = (await res.json()) as {
          nonce: string;
          exp: number;
          sig: string;
        };
        if (cancelled) return;
        challengeRef.current = ch;
        mountedAtRef.current =
          typeof performance !== "undefined" ? performance.now() : 0;
        setState("ready");
      } catch {
        if (!cancelled) {
          setState("error");
          setMessage("Could not load the check. Refresh and try again.");
        }
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("touchmove", onMove);
    };
  }, []);

  async function verify(e: React.MouseEvent) {
    if (state !== "ready") return;
    const ch = challengeRef.current;
    if (!ch) return;
    setState("checking");
    setMessage(null);

    const now = typeof performance !== "undefined" ? performance.now() : 0;
    const elapsedMs = Math.round(now - mountedAtRef.current);

    try {
      const res = await fetch("/api/human-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nonce: ch.nonce,
          exp: ch.exp,
          sig: ch.sig,
          elapsedMs,
          moves: movesRef.current,
          // e.nativeEvent.isTrusted is true only for real user gestures,
          // false for synthetic .click() calls a script would use.
          trusted: e.nativeEvent.isTrusted === true,
        }),
      });
      if (!res.ok) {
        setState("ready");
        setMessage(
          res.status === 429
            ? "Too many attempts. Wait a moment and try again."
            : "That didn't look quite right. Try clicking again.",
        );
        return;
      }
      const pass = (await res.json()) as { pass: string; exp: number };
      setState("verified");
      onVerified({ ...pass, nonce: ch.nonce });
    } catch {
      setState("ready");
      setMessage("Network hiccup. Try again.");
    }
  }

  const verified = state === "verified";

  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={verify}
        disabled={state !== "ready"}
        aria-pressed={verified}
        className={
          "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors " +
          (verified
            ? "border-emerald-300 bg-emerald-50/70 cursor-default"
            : "border-forest-200 bg-white hover:border-forest-300 disabled:opacity-60 disabled:cursor-wait")
        }
      >
        <span
          aria-hidden="true"
          className={
            "grid size-5 shrink-0 place-items-center rounded-md border " +
            (verified
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-forest-300 bg-cream")
          }
        >
          {verified ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12l4 4L19 7"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : state === "checking" ? (
            <span className="size-3 animate-spin rounded-full border-2 border-forest-300 border-t-forest-700" />
          ) : null}
        </span>
        <span className="font-medium text-forest-900" aria-live="polite">
          {verified
            ? "You're verified"
            : state === "checking"
              ? "Checking..."
              : "I'm human"}
        </span>
      </button>
      {message ? (
        <p className="text-[11px] text-amber-700" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
