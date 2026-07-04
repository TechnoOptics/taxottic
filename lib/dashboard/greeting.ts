/**
 * Personalized greeting helpers. Always warm, never twee. Rotates so the
 * user does not see the exact same line every visit.
 *
 * Timezone correctness matters: this runs server-side, but we want a
 * greeting that matches the user's wall-clock time, not UTC. Until we
 * know the user's TZ (we don't yet capture it), we use the server's
 * local time via getHours(); for Vercel's defaults that is UTC, which
 * was producing wrong-feeling lines (e.g., "Burning the midnight oil"
 * at 9 AM in California). To avoid the worst-case mismatch we keep any
 * "late at night" phrasing OUT of the daytime buckets and gate it to a
 * tight late-night window. If the user's actual local time differs by
 * a few hours we still pick a generic "Welcome back", which always reads
 * correctly.
 */

// Time-of-day buckets used to live here, but the May 2026 weekly
// audit observed "Working late" / "Burning the midnight oil" rendered
// at 7:40 PM PT, the Vercel server's UTC clock was past 03:00 the
// next day, hitting the LATE bucket while the user's wall clock said
// early evening. Until we capture the user's timezone offset, the
// only way to guarantee the greeting reads correctly is to use
// phrases that are time-of-day-neutral.
//
// We keep the MORNING/MIDDAY/EVENING buckets so a future
// TZ-aware caller can still differentiate, but the lines inside
// each bucket are now safe to read at *any* hour. The LATE bucket
// is gone, its specifically-after-dark phrases were the source
// of the audit finding.
const MORNING = [
  "Welcome back",
  "Glad to see you",
  "Right back at it",
  "Good to see you",
];
const MIDDAY = [
  "Welcome back",
  "Glad to see you",
  "Right back at it",
  "Hope you're well",
];
const EVENING = [
  "Welcome back",
  "Glad to see you",
  "Good to see you",
  "Hope you're well",
];

const PLEASANTRIES = [
  "Let's keep your numbers tight.",
  "Small steps today, fewer surprises in April.",
  "A few minutes here saves hours later.",
  "You're doing the work most people put off.",
  "Calm and consistent. That is the whole game.",
  "Every captured deduction is dollars you keep.",
];

export function buildGreeting(args: {
  fullName?: string | null;
  email?: string | null;
}) {
  // Server-local hour (UTC on Vercel by default). With the lines in
  // each bucket now time-neutral, a mismatch between server-UTC and
  // user-local hour can only ever change rotation, never produce
  // a wrong-feeling phrase. A future tz-aware caller (e.g. passing
  // a `_tz_offset_min` cookie set client-side) can plug in here.
  const now = new Date();
  const hour = now.getHours();
  let bucket: string[];
  if (hour < 12) {
    bucket = MORNING;
  } else if (hour < 17) {
    bucket = MIDDAY;
  } else {
    bucket = EVENING;
  }

  const head = bucket[Math.floor(Math.random() * bucket.length)];
  const pleasantry =
    PLEASANTRIES[Math.floor(Math.random() * PLEASANTRIES.length)];

  // First name comes from the profile's full_name only. We deliberately
  // do NOT derive a "name" from the email local-part anymore - generic
  // role addresses (contact@, info@, hello@, support@, billing@) were
  // turning into greetings like "Good morning, Contact." which read as
  // a bug to anyone signed in on a shared inbox. When we have no real
  // name, drop the suffix instead of guessing.
  //
  // Defensive: if the user pasted a company name into the name field
  // during onboarding (the May 2026 audit saw "Good evening, Advottic"
  // because of this), the trailing entity suffix gives it away. We drop
  // the name in that case rather than greeting someone by their LLC.
  // Caller can fix the underlying profile.full_name in onboarding; this
  // is the safety net.
  const COMPANY_SUFFIX_RE =
    /\b(llc|l\.l\.c\.|inc|inc\.|corp|corporation|co|co\.|ltd|ltd\.|llp|plc|gmbh|s\.a\.|s\.a\.s\.|s\.r\.l\.|ag|ab)\b/i;
  const fullClean = args.fullName?.trim() ?? "";
  const looksLikeCompany = COMPANY_SUFFIX_RE.test(fullClean);
  const name = looksLikeCompany
    ? undefined
    : fullClean.split(/\s+/)[0]?.trim();
  const displayName = name
    ? name.replace(/\b\w/g, (c) => c.toUpperCase())
    : "";

  return {
    head: displayName ? `${head}, ${displayName}.` : `${head}.`,
    pleasantry,
  };
}
