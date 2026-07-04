"use client";

import { useState } from "react";

/**
 * "Send me a test push", fires /api/push/test and renders the
 * diagnostic verbatim, so the user can verify their FCM/APNs setup
 * without taking a drive. Lives on /settings/security under
 * "Sign-in and devices".
 *
 * The endpoint returns a structured diagnostic:
 *   { ok, hint, tokens: {active, revoked}, providers: {…}, result: {…} }
 *
 * We render `hint` prominently, it's the human-readable "what's
 * missing" message, and put the raw counts in a mono small font so
 * the user can copy them into a support thread if they need to.
 */
type Diagnostic = {
  ok: boolean;
  hint: string;
  tokens: { active: number; revoked: number };
  providers: { apnsConfigured: boolean; fcmConfigured: boolean };
  result?: { sent: boolean; delivered: number; revoked: number };
};

export function TestPushButton() {
  const [loading, setLoading] = useState(false);
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setLoading(true);
    setError(null);
    setDiag(null);
    try {
      const res = await fetch("/api/push/test", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setError(`Request failed: ${res.status}`);
        return;
      }
      const json = (await res.json()) as Diagnostic;
      setDiag(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={send}
        disabled={loading}
        className="btn-primary text-sm h-10 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Sending..." : "Send a test push"}
      </button>
      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : null}
      {diag ? (
        <div
          className={
            "mt-4 rounded-xl p-4 text-sm border " +
            (diag.ok
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-amber-50 border-amber-200 text-amber-900")
          }
        >
          <div className="font-medium">
            {diag.ok ? "Push attempted, check your lock screen" : "Push didn't deliver"}
          </div>
          <p className="mt-1.5 leading-relaxed">{diag.hint}</p>
          <p className="mt-2 font-mono text-[11px] text-ink-soft break-all">
            tokens: active={diag.tokens.active} revoked=
            {diag.tokens.revoked} · apns=
            {diag.providers.apnsConfigured ? "yes" : "no"} · fcm=
            {diag.providers.fcmConfigured ? "yes" : "no"}
            {diag.result
              ? ` · sent=${String(diag.result.sent)} delivered=${diag.result.delivered} prov_revoked=${diag.result.revoked}`
              : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
