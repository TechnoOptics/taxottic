import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * Server-side Plaid client. Reads three env vars:
 *   PLAID_CLIENT_ID    - same in every environment
 *   PLAID_SECRET       - per-environment (sandbox / development / production)
 *   PLAID_ENV          - "sandbox" | "development" | "production"
 *
 * Returns null if the keys aren't configured so callers can render a
 * "feature not yet available" state instead of crashing. Without keys
 * the Banks page is still useful (paywall card + CSV import paths).
 */
export function getPlaidClient(): PlaidApi | null {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
  if (!clientId || !secret) return null;
  const basePath =
    PlaidEnvironments[env as keyof typeof PlaidEnvironments] ??
    PlaidEnvironments.sandbox;
  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
        "Plaid-Version": "2020-09-14",
      },
    },
  });
  return new PlaidApi(config);
}

export function getPlaidEnv(): "sandbox" | "development" | "production" {
  const raw = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
  if (raw === "development" || raw === "production") return raw;
  return "sandbox";
}
