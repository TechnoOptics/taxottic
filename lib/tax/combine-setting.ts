import type { EntityType } from "./forecast";

/**
 * Resolve whether a user's business should be COMBINED into their personal
 * tax forecast (its net flows onto the personal 1040) or kept SEPARATE.
 *
 * An explicit user preference (the Settings toggle, Phase 3) wins. When it
 * is unset (null/undefined), fall back to the tax-correct default per entity
 * type: pass-through entities combine (their net is taxed on the owner's
 * personal return at progressive rates), while a C-corp is taxed at the
 * entity level and stays separate.
 *
 * Keeping this in one place means the forecast, dashboard, and (later) the
 * Settings toggle all agree. See docs/PERSONAL_BUSINESS_SEPARATION_PLAN.md.
 */
export function resolveCombine(
  userPref: boolean | null | undefined,
  entityType: EntityType | string | null | undefined,
): boolean {
  if (userPref === true || userPref === false) return userPref;
  // Only the C-corp defaults to separate; every pass-through defaults to
  // combined (the historical behavior, so existing users are unchanged).
  return (entityType ?? "sole_prop") === "c_corp" ? false : true;
}
