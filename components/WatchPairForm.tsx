"use client";

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

/**
 * Six-digit pairing form for /settings → Devices.
 *
 * The user reads the code off their watch (TAXOTTIC pair screen)
 * and types each digit into one of six tightly-spaced inputs. Each
 * input accepts exactly one digit, advances focus on entry, and
 * Backspace on an empty input falls back to the previous box. When
 * all six are filled we POST `/api/watch/pair/redeem`, the watch
 * polls `/pair/poll` every few seconds and pulls down its token.
 *
 * Session auth happens at the API; this form does not touch any
 * secrets. A second pairing for a different watch is just clicking
 * "Pair another watch", which resets the form state.
 */

type Status = "idle" | "linking" | "done" | "error";

const MESSAGES: Record<string, string> = {
  invalid_code: "That code wasn't recognised. Re-check the watch.",
  code_used: "That code was already used. Re-open the pair screen on your watch.",
  code_expired:
    "That code expired (codes live ~2 min). Re-open the pair screen on your watch.",
  missing_code: "Enter all six digits from your watch.",
  rate_limited: "Too many tries. Wait a moment, then try again.",
  unauthorized: "Sign in on this phone, then try again.",
};

export function WatchPairForm() {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  function focusAt(idx: number) {
    const next = inputsRef.current[idx];
    if (next) {
      next.focus();
      next.select();
    }
  }

  function setAt(idx: number, value: string) {
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  function onChange(idx: number) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.replace(/\D+/g, "");
      if (!raw) {
        setAt(idx, "");
        return;
      }
      // Handle paste of all 6 digits into one box.
      if (raw.length >= 6 && idx === 0) {
        const six = raw.slice(0, 6).split("");
        setDigits(six);
        focusAt(5);
        // Auto-submit when paste completes the code.
        void submit(six.join(""));
        return;
      }
      // Take just the first digit of whatever the user typed; if they
      // pasted multi-digit content into a non-first box, spread it.
      const chars = raw.split("");
      const taken = chars[0];
      setAt(idx, taken);
      if (idx < 5) focusAt(idx + 1);
      // Spread overflow chars into the next inputs (paste in middle).
      if (chars.length > 1) {
        let cursor = idx + 1;
        for (const c of chars.slice(1)) {
          if (cursor > 5) break;
          setAt(cursor, c);
          cursor++;
        }
        focusAt(Math.min(cursor, 5));
      }
    };
  }

  function onKeyDown(idx: number) {
    return (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !digits[idx] && idx > 0) {
        focusAt(idx - 1);
      } else if (e.key === "ArrowLeft" && idx > 0) {
        e.preventDefault();
        focusAt(idx - 1);
      } else if (e.key === "ArrowRight" && idx < 5) {
        e.preventDefault();
        focusAt(idx + 1);
      } else if (e.key === "Enter") {
        const code = digits.join("");
        if (code.length === 6) void submit(code);
      }
    };
  }

  async function submit(code: string) {
    if (status === "linking") return;
    setStatus("linking");
    setMsg(null);
    try {
      const res = await fetch("/api/watch/pair/redeem", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        setStatus("done");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus("error");
      setMsg(MESSAGES[body.error ?? ""] ?? "Couldn't pair. Please try again.");
    } catch {
      setStatus("error");
      setMsg("Network error. Check your connection and try again.");
    }
  }

  function reset() {
    setDigits(Array(6).fill(""));
    setStatus("idle");
    setMsg(null);
    focusAt(0);
  }

  if (status === "done") {
    return (
      <div className="text-center">
        <div className="text-3xl text-gold-500" aria-hidden="true">
          ✓
        </div>
        <div className="display mt-2 text-lg text-forest-900">
          Watch paired
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          Your watch will start showing your live forecast within a minute.
        </p>
        <button
          type="button"
          onClick={reset}
          className="btn-ghost mt-4 text-sm"
        >
          Pair another watch
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-ink-soft">
        Open the Taxottic app on your watch, the &quot;Pair watch&quot; screen
        shows a six-digit code. Type it in here.
      </p>
      <div
        role="group"
        aria-label="Watch pairing code"
        className="mt-4 flex gap-2 justify-center"
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={1}
            value={d}
            onChange={onChange(i)}
            onKeyDown={onKeyDown(i)}
            aria-label={`Digit ${i + 1}`}
            className="w-11 sm:w-12 h-14 text-center text-2xl font-semibold rounded-xl border border-forest-100 bg-white text-forest-900 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200"
          />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => submit(digits.join(""))}
          disabled={status === "linking" || digits.join("").length !== 6}
          className="btn-primary text-sm disabled:opacity-60"
        >
          {status === "linking" ? "Pairing…" : "Pair watch"}
        </button>
        {digits.some((d) => d !== "") ? (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-ink-muted hover:text-forest-900 underline-offset-2 hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>
      {msg ? <p className="mt-3 text-sm text-red-700">{msg}</p> : null}
    </div>
  );
}
