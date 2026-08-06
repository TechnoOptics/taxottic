/**
 * User-facing copy for a failed Bella categorize pass.
 *
 * Why this exists: `runBellaCategorize` throws on every failure path,
 * and `bellaAutoApply` used to let those throws escape the Server
 * Action untouched. React redacts an uncaught Server Action / Server
 * Component error in production, so the user saw:
 *
 *   "An error occurred in the Server Components render. The specific
 *    message is omitted in production builds to avoid leaking
 *    sensitive details. A digest property is included ..."
 *
 * That swallowed messages the code had already written *for the user*
 * ("Bella needs 10 credits ...", "Bella didn't return valid JSON ..."),
 * and left no way to tell an out-of-credits case from an outage. The
 * caller now catches, shapes through here, and redirects back with
 * `?error=`, the same pattern `uploadErrorMessage` uses for uploads.
 *
 * Rule of thumb: pass Bella's own copy through untouched, translate
 * infrastructure failures into something actionable, and never return
 * an empty string. An unrecognized cause is surfaced verbatim (capped)
 * rather than hidden, because a readable wrong-ish message beats an
 * opaque digest.
 */

const MAX_RAW = 200;

export function bellaErrorMessage(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err ?? "")).trim();

  // Server misconfiguration. Don't echo the env-var name at an end
  // user; it's noise to them and a hint to everyone else.
  if (/ANTHROPIC_API_KEY/i.test(raw)) {
    return "Bella is not set up on the server yet. Nothing was changed, please contact support.";
  }

  // Credentials rejected upstream (revoked or rotated key).
  if (/authentication_error|invalid x-api-key|\b401\b/i.test(raw)) {
    return "Bella's API credentials were rejected. Nothing was changed, please contact support.";
  }

  // Transient upstream conditions. The categorize pass writes nothing
  // until the model has answered, so the import really is untouched.
  if (
    /rate_limit|\b429\b|overloaded|\b529\b|\b50[0-9]\b|timed out|timeout|ETIMEDOUT|ECONNRESET|fetch failed|socket hang up/i.test(
      raw,
    )
  ) {
    return "Bella could not be reached just now. The import is unchanged, try again in a moment.";
  }

  // Already written for the user by the categorizer or the credits
  // engine. Passing these through verbatim is the whole point.
  if (/^Bella (needs|didn't|did not|returned|ran out)/i.test(raw)) return raw;

  if (/Not a member of this company/i.test(raw)) {
    return "You don't have access to this company.";
  }
  if (/Import not found/i.test(raw)) {
    return "That import no longer exists. Refresh and try again.";
  }

  if (!raw) {
    return "Bella could not finish. The import is unchanged, try again.";
  }
  return `Bella could not finish: ${raw.slice(0, MAX_RAW)}`;
}
