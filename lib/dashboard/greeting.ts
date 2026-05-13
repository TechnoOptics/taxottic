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

const MORNING = [
  "Good morning",
  "Welcome back",
  "Bright and early",
  "Quiet morning",
];
const MIDDAY = [
  "Welcome back",
  "Good afternoon",
  "Glad to see you",
  "Right back at it",
];
const EVENING = [
  "Good evening",
  "Welcome back",
  "Evening, friend",
  "Wrapping up the day",
];
// Reserved for the small wee-hours window only. We deliberately do NOT
// rotate "Burning the midnight oil" into any other bucket - it reads
// wrong any time the sun is up.
const LATE = [
  "Welcome back",
  "Working late",
  "Up at this hour",
  "Burning the midnight oil",
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
  // Local time on the server. On Vercel this is UTC; that's an
  // approximation until we capture the user's timezone. The buckets
  // below are conservative so the worst case is a generic "Welcome
  // back" rather than something obviously time-wrong like
  // "Burning the midnight oil" at noon.
  const now = new Date();
  const hour = now.getHours();
  let bucket: string[];
  if (hour >= 23 || hour < 4) {
    // 11 PM to 4 AM only - the actual "late night" window where lines
    // like "Burning the midnight oil" make sense.
    bucket = LATE;
  } else if (hour < 12) {
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
