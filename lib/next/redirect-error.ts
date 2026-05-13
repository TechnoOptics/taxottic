/**
 * Detect Next.js's `redirect()` control-flow error.
 *
 * Background: in Next.js 16 (App Router), calling `redirect("/foo")`
 * from a Server Action does NOT return — it throws a special error
 * with `digest = "NEXT_REDIRECT;<type>;<url>;<status>;"`. The
 * framework's outermost handler catches it and emits the actual HTTP
 * redirect response.
 *
 * The problem: when a client component does `await action()` inside
 * a try/catch, the redirect error gets caught by the catch block. The
 * developer sees an "error" they probably want to display in red — but
 * what they're catching is the SUCCESS PATH. The redirect still
 * happens (Next handles it at the framework level after the component
 * unmounts), so the user briefly sees a flash of red error text
 * before the navigation completes.
 *
 * The bug shipped in NewCompanyWizard.tsx as the May 2026 "brief
 * error in red before the personal tax profile" report.
 *
 * Why this helper instead of `isRedirectError` from `next/navigation`:
 * `isRedirectError` IS implemented in Next.js but is NOT exported from
 * the public `next/navigation` package (as of 16.2.4). It lives at
 * `next/dist/client/components/redirect-error` which is an internal
 * path and brittle across Next versions. We pattern-match the digest
 * prefix directly — that contract has been stable since the App Router
 * launched and is documented in the Next.js source.
 *
 * The companion `NEXT_NOT_FOUND` digest works the same way; same
 * helper covers it. Re-throw both kinds so the framework can do its
 * job.
 */

const REDIRECT_CONTROL_FLOW_DIGESTS = [
  "NEXT_REDIRECT",
  "NEXT_NOT_FOUND",
] as const;

export function isNextControlFlowError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;
  return REDIRECT_CONTROL_FLOW_DIGESTS.some((d) => digest.startsWith(d));
}

/**
 * Helper to drop into a try/catch that wraps `await someServerAction()`.
 *
 * Usage:
 *
 *   try {
 *     await action(formData);
 *   } catch (err) {
 *     rethrowIfRedirect(err);
 *     setError(err instanceof Error ? err.message : "Something went wrong.");
 *   }
 *
 * If `err` is a Next.js control-flow error (redirect or notFound),
 * the helper re-throws so the framework handles it. Otherwise it
 * returns normally and the caller's downstream error handling runs.
 */
export function rethrowIfRedirect(err: unknown): void {
  if (isNextControlFlowError(err)) {
    throw err;
  }
}
