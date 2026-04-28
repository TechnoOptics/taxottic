/**
 * Personalized greeting helpers. Always warm, never twee. Rotates so the
 * user does not see the exact same line every visit.
 */

const MORNING = [
  "Good morning",
  "Welcome back",
  "Quiet morning",
];
const MIDDAY = [
  "Welcome back",
  "Good afternoon",
  "Glad to see you",
];
const EVENING = [
  "Good evening",
  "Welcome back",
  "Evening, friend",
];
const LATE = [
  "Working late",
  "Welcome back",
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
  const now = new Date();
  const hour = now.getUTCHours();
  let bucket: string[];
  if (hour < 5) bucket = LATE;
  else if (hour < 12) bucket = MORNING;
  else if (hour < 17) bucket = MIDDAY;
  else if (hour < 22) bucket = EVENING;
  else bucket = LATE;

  const head = bucket[Math.floor(Math.random() * bucket.length)];
  const pleasantry =
    PLEASANTRIES[Math.floor(Math.random() * PLEASANTRIES.length)];

  const name = args.fullName?.split(/\s+/)[0]?.trim();
  const fallback = args.email?.split("@")[0]?.split(/[._-]/)[0];
  const displayName = (name || fallback || "").replace(/\b\w/g, (c) =>
    c.toUpperCase(),
  );

  return {
    head: displayName ? `${head}, ${displayName}.` : `${head}.`,
    pleasantry,
  };
}
