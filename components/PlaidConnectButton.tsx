"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useRouter } from "next/navigation";

type Props = {
  companyPublicId: string;
  companyId: string;
  className?: string;
  // When true, force a fresh link_token fetch on mount instead of
  // waiting for the user click. Used by the OAuth-return page so
  // Plaid Link can resume mid-flow.
  resumeOAuth?: boolean;
};

/**
 * Connect-bank button that opens Plaid Link. Three things happen:
 *   1. We POST to /api/banks/plaid/link-token to mint a token
 *   2. usePlaidLink opens the modal with that token
 *   3. On success, we POST the public_token to /exchange and refresh
 *      the page so the new connection appears
 *
 * The button shows three states: idle (cta), loading (fetching token
 * or exchanging), and error (lets the user retry).
 */
export function PlaidConnectButton({
  companyPublicId,
  companyId,
  className,
  resumeOAuth = false,
}: Props) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLinkToken = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/banks/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error === "plaid_not_configured") {
          setError(
            "Bank connections aren't enabled on this environment yet. Try again once Plaid keys are set.",
          );
        } else {
          setError(data?.error ?? "Couldn't open bank connect.");
        }
        setBusy(false);
        return;
      }
      setLinkToken(data.link_token);
      // Persist the company id for OAuth-return resume (Plaid Link
      // OAuth-flow institutions redirect away from our origin).
      try {
        localStorage.setItem("plaid_oauth_company_id", companyPublicId);
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }, [companyId, companyPublicId]);

  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      setBusy(true);
      setError(null);
      try {
        const inst = metadata?.institution ?? null;
        const res = await fetch("/api/banks/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicToken,
            companyId,
            institutionId: inst?.institution_id ?? null,
            institutionName: inst?.name ?? null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "Linking failed.");
          setBusy(false);
          return;
        }
        try {
          localStorage.removeItem("plaid_oauth_company_id");
        } catch {
          /* ignore */
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Linking failed.");
        setBusy(false);
      }
    },
    [companyId, router],
  );

  // Resume the OAuth flow if we're on the return page. The client
  // detects this via the resumeOAuth prop; we re-fetch a token and
  // open Plaid Link with the original receivedRedirectUri.
  useEffect(() => {
    if (resumeOAuth && !linkToken && !busy) {
      fetchLinkToken();
    }
  }, [resumeOAuth, linkToken, busy, fetchLinkToken]);

  const receivedRedirectUri =
    typeof window !== "undefined" && resumeOAuth
      ? sessionStorage.getItem("plaid_oauth_return_url") ?? undefined
      : undefined;

  // Plaid Link sets `body { overflow: hidden }` while the modal is
  // open and is supposed to clean it up on close, but on first-render
  // racing it sometimes leaves the lock behind, breaking page scroll.
  // Restore explicitly on every close path (success, exit, unmount).
  function restoreScroll() {
    if (typeof document === "undefined") return;
    document.body.style.removeProperty("overflow");
    document.documentElement.style.removeProperty("overflow");
  }

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess: (publicToken, metadata) => {
      restoreScroll();
      onSuccess(publicToken, metadata);
    },
    onExit: () => {
      restoreScroll();
      setBusy(false);
    },
    receivedRedirectUri,
  });

  // Belt + suspenders: if the user navigates away mid-flow or hot
  // reload kills the component before Plaid's own teardown runs, the
  // unmount cleanup unlocks scroll.
  useEffect(() => {
    return () => {
      restoreScroll();
    };
  }, []);

  useEffect(() => {
    if (linkToken && ready && (resumeOAuth || busy)) {
      // Open the modal as soon as the token + SDK are ready, either
      // because the user clicked (busy=true) or because we're
      // resuming an OAuth round-trip.
      open();
    }
  }, [linkToken, ready, busy, resumeOAuth, open]);

  function onClick() {
    if (linkToken && ready) {
      setBusy(true);
      open();
      return;
    }
    fetchLinkToken();
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={className ?? "btn-primary"}
      >
        {busy ? "Opening..." : "Connect a bank"}
      </button>
      {error ? (
        <p className="mt-2 text-xs text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
