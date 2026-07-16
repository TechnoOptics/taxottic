// Employee personal-hub entitlement (product rule, 2026-07-15):
//
//   "An employee should have a business profile, not a personal one,
//    unless they subscribe for their own personal one."
//
// Business owners / managers pay for the company and keep the personal
// tax hub as part of their own account (even on the free tier). A person
// whose ONLY relationship to the app is being someone else's employee
// (a plain member/expenser who owns no company) does NOT get the personal
// hub for free — they must hold their own active PAID plan.
//
// Why "paid, not trialing": every new signup is auto-granted a `solo`
// trial at account creation, invited employees included. Counting a trial
// as access would unlock personal for every employee and defeat the rule.
// A deliberate paid subscription is the signal that they bought personal
// for themselves. (If you'd rather trials count, widen ACTIVE_PAID below.)

export type MembershipRole = "manager" | "lead" | "member" | "expenser";

export type PersonalAccessInput = {
  /** The caller's role in each company they belong to. */
  roles: MembershipRole[];
  /** Their own subscription plan (null = no subscription row). */
  plan: string | null;
  /** Their own subscription status (null = no subscription row). */
  status: string | null;
};

/** A user "owns" their place in the product if they lead any company —
 *  creating a company makes you its manager, so this also covers owners. */
function isOwnerLike(roles: MembershipRole[]): boolean {
  return roles.some((r) => r === "manager" || r === "lead");
}

/** A real paid subscription: active (not merely trialing) and above free. */
function hasPaidPersonalPlan(plan: string | null, status: string | null): boolean {
  return status === "active" && plan != null && plan !== "free";
}

/**
 * Decide whether the personal tax hub is LOCKED for this user.
 * Locked ⇒ hide the Personal workspace and show the upgrade upsell.
 */
export function isPersonalLocked(input: PersonalAccessInput): boolean {
  // Owners/managers (and anyone who created a company) always keep personal.
  if (isOwnerLike(input.roles)) return false;
  // Solo users with no company at all are personal-first — never locked.
  if (input.roles.length === 0) return false;
  // Employee-only: personal is gated behind their own paid plan.
  return !hasPaidPersonalPlan(input.plan, input.status);
}
