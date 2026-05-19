"use client";

import { useState } from "react";

// The signed-in phone's confirm step: POST the scanned code to
// /api/watch/pair/redeem (session-authed — the watch joins whoever is
// signed in here). One tap, clear result, no secrets shown.

type Status = "idle" | "linking" | "done" | "error";

const MESSAGES: Record<string, string> = {
  invalid_code: "That code wasn't recognised. Re-open the QR on your watch.",
  code_used: "That code was already used. Re-open the QR on your watch.",
  code_expired: "That code expired. Re-open the QR on your watch.",
  missing_code: "No code found. Scan the QR shown on your watch.",
};

export function WatchLinkConfirm({ code }: { code: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function link() {
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
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setStatus("error");
      setMsg(
        MESSAGES[body.error ?? ""] ??
          "Couldn't link the watch. Please try again.",
      );
    } catch {
      setStatus("error");
      setMsg("Network error. Check your connection and try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-2xl bg-[#1d2843] border border-[#d5bb7e26] p-6 text-center">
        <div className="text-3xl">✓</div>
        <h2 className="mt-2 text-lg font-semibold text-[#fbf7e9]">
          Watch linked
        </h2>
        <p className="mt-1 text-sm text-[#fbf7e9b3]">
          Your watch is now tied to this account and will start syncing
          your forecast and confirmations within a minute.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#1d2843] border border-[#d5bb7e26] p-6 text-center">
      <h2 className="text-lg font-semibold text-[#fbf7e9]">
        Link your watch
      </h2>
      <p className="mt-1 text-sm text-[#fbf7e9b3]">
        This connects the Taxottic watch app to your signed-in account
        so it can show your live forecast and sync confirmations.
      </p>
      <button
        onClick={link}
        disabled={status === "linking"}
        className="mt-5 w-full rounded-xl bg-[#d5bb7e] px-4 py-3 font-semibold text-[#121a2a] disabled:opacity-60"
      >
        {status === "linking" ? "Linking…" : "Link this watch"}
      </button>
      {msg ? (
        <p className="mt-3 text-sm text-[#e6b8a8]">{msg}</p>
      ) : null}
    </div>
  );
}
