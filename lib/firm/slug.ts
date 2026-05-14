import type { SupabaseClient } from "@supabase/supabase-js";

// Slug derivation + uniqueness for firm subdomains.
//
// Rules (matches the CHECK constraint on firms.slug in the
// 20260514000003 migration):
//   - 3 to 32 chars total
//   - first + last char must be alphanumeric
//   - body may contain a-z, 0-9, and single hyphens
//   - lowercase
//
// If the derived slug collides with an existing firm we append
// `-2`, `-3`, ... until we find a free one. The DB enforces
// uniqueness via the partial unique index `firms_slug_unique`, so
// even if two approvals race we won't break the constraint — the
// second insert just fails and the operator retries from the
// /admin/firms surface.
//
// We deliberately scrub common words that would make the slug
// awkward in a URL ("inc", "llc", "the", "and", "cpa", "&") rather
// than blacklisting them outright. A firm named "Smith & Allen CPA"
// becomes "smith-allen-cpa" not "the-smith-allen-cpa-llc". Operators
// can override with an explicit slug input on the approval form.

const STRIP_WORDS = new Set([
  "and",
  "the",
  "of",
  // We intentionally keep "cpa", "llp", "llc", "inc", etc. because
  // those are signal — a slug that says "smith-allen-cpa" is more
  // recognizable than "smith-allen". Only the genuinely throwaway
  // glue words get dropped.
]);

const MIN_LEN = 3;
const MAX_LEN = 32;

export function deriveSlugCandidate(firmName: string): string {
  // 1. Lowercase + ASCII-fold-ish. We don't try to transliterate
  //    non-Latin scripts here (Hangul, Arabic, CJK) because a firm
  //    name in those scripts is better served by an explicit
  //    operator-provided slug on the approval form. The fallback
  //    below ensures we never insert an empty slug.
  const lower = firmName.toLowerCase();
  // 2. Replace ampersands with "and" so "Smith & Allen" -> "smith-and-allen"
  //    then immediately strip "and" if it landed in STRIP_WORDS — net
  //    effect is "smith-allen". The "&"->"and" detour preserves the
  //    intent for languages that don't have an ampersand mapping.
  const expanded = lower.replace(/&/g, " and ");
  // 3. Tokenize on non-alphanumeric; drop empty + STRIP_WORDS tokens.
  const tokens = expanded
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 0 && !STRIP_WORDS.has(t));
  if (tokens.length === 0) {
    return ""; // caller falls back to manual entry
  }
  // 4. Hyphenate, trim to MAX_LEN, then re-trim trailing hyphens.
  let s = tokens.join("-");
  if (s.length > MAX_LEN) {
    s = s.slice(0, MAX_LEN);
    // After truncating, make sure we don't end mid-token with a
    // trailing hyphen — that would fail the CHECK constraint.
    s = s.replace(/-+$/, "");
  }
  // 5. Pad short slugs. A firm named "AC" would derive to "ac" (2
  //    chars); pad to "ac-cpa" so it clears the minimum.
  if (s.length < MIN_LEN) {
    s = (s + "-firm").slice(0, MAX_LEN);
  }
  return s;
}

/** Reserved words / system slugs we don't want a firm to claim. */
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "bella",
  "billing",
  "book",
  "c",
  "changelog",
  "dashboard",
  "enterprise",
  "enterprise-welcome",
  "example",
  "firm",
  "firms",
  "goals",
  "help",
  "hq",
  "invite",
  "legal",
  "login",
  "onboarding",
  "personal",
  "pricing",
  "reminders",
  "settings",
  "static",
  "support",
  "www",
]);

export function isValidSlugFormat(slug: string): boolean {
  if (!slug) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug);
}

/**
 * Find an unclaimed slug for the given firm name. Tries the
 * derived candidate first; on collision appends `-2`, `-3`, ...
 * Caller is responsible for inserting under a unique constraint —
 * this just gives a safe starting point.
 */
export async function pickAvailableSlug(
  admin: SupabaseClient,
  firmName: string,
  manualOverride?: string,
): Promise<string> {
  const seed =
    manualOverride && isValidSlugFormat(manualOverride.toLowerCase())
      ? manualOverride.toLowerCase()
      : deriveSlugCandidate(firmName);
  if (!seed || !isValidSlugFormat(seed)) {
    // Last-resort fallback: a timestamp-suffixed slug so the
    // approval doesn't block on a bad firm name. The operator can
    // rename later via firm settings.
    return `firm-${Date.now().toString(36).slice(-6)}`;
  }

  // Pull existing slugs that share the prefix so we can pick the
  // next free suffix in one round-trip.
  const { data: clashes } = await admin
    .from("firms")
    .select("slug")
    .like("slug", `${seed}%`);
  const taken = new Set(
    (clashes ?? []).map((r) => (r.slug as string) ?? ""),
  );
  if (!taken.has(seed)) return seed;
  for (let n = 2; n < 100; n++) {
    const candidate = `${seed}-${n}`.slice(0, MAX_LEN).replace(/-+$/, "");
    if (!taken.has(candidate)) return candidate;
  }
  // Pathological: 100 firms with the same derived seed. Stamp with
  // a six-char base36 timestamp suffix.
  return `${seed}-${Date.now().toString(36).slice(-6)}`.slice(0, MAX_LEN);
}
