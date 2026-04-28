"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/Wordmark";
import { PasskeySignInButton } from "@/components/PasskeySignInButton";

type Provider = "google" | "azure" | "apple";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  async function oauth(provider: Provider) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: provider === "azure" ? "email openid profile" : undefined,
      },
    });
    if (error) setError(error.message);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Wordmark size="lg" />
          <p className="mt-3 text-sm text-ink-soft">
            Sign in to forecast your taxes.
          </p>
        </div>

        <div className="card p-7">
          <div className="grid gap-2">
            <button
              onClick={() => oauth("google")}
              className="btn-ghost w-full"
            >
              Continue with Google
            </button>
            <button
              onClick={() => oauth("azure")}
              className="btn-ghost w-full"
            >
              Continue with Microsoft
            </button>
            <button
              onClick={() => oauth("apple")}
              className="btn-ghost w-full"
            >
              Continue with Apple
            </button>
          </div>

          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-ink-muted">
            <div className="h-px flex-1 bg-forest-200/60" />
            <span>or passkey</span>
            <div className="h-px flex-1 bg-forest-200/60" />
          </div>

          <PasskeySignInButton emailHint={email || undefined} />

          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-ink-muted">
            <div className="h-px flex-1 bg-forest-200/60" />
            <span>or email</span>
            <div className="h-px flex-1 bg-forest-200/60" />
          </div>

          <form onSubmit={sendMagicLink} className="grid gap-3">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="btn-primary w-full"
            >
              {status === "sending" ? "Sending..." : "Send magic link"}
            </button>
          </form>

          {status === "sent" && (
            <p className="mt-4 text-sm text-forest-700">
              Check your inbox for the sign-in link.
            </p>
          )}
          {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-ink-muted text-center max-w-sm mx-auto">
          Taxottic provides tax forecasting and educational guidance. It is not
          a substitute for advice from a licensed CPA or tax attorney.
        </p>
      </div>
    </main>
  );
}
