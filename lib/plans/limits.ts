/**
 * Plan limits + pricing.
 *
 * Free tier mirrors what the underlying providers give us at no cost (e.g.,
 * Anthropic's signup credits + a small monthly quota we can absorb). Anything
 * past these caps requires Pro.
 *
 * Numbers in `bellaMessagesPerMonth` are tied to real cost: each question
 * costs ~$0.01-0.02 at our edge, so 10 questions/free-user/month = ~$0.20
 * which is acceptable for a freemium funnel.
 */

export type Plan = "free" | "pro" | "team";

export const PLAN_LIMITS = {
  free: {
    bellaMessagesPerMonth: 10,
    csvImportsPerMonth: 1,
    companies: 1,
    invitesPerCompany: 0,        // free users are solo
  },
  pro: {
    bellaMessagesPerMonth: Number.POSITIVE_INFINITY,
    csvImportsPerMonth: Number.POSITIVE_INFINITY,
    companies: Number.POSITIVE_INFINITY,
    invitesPerCompany: Number.POSITIVE_INFINITY,
  },
  team: {
    bellaMessagesPerMonth: Number.POSITIVE_INFINITY,
    csvImportsPerMonth: Number.POSITIVE_INFINITY,
    companies: Number.POSITIVE_INFINITY,
    invitesPerCompany: Number.POSITIVE_INFINITY,
  },
} as const;

export type PlanLimits = (typeof PLAN_LIMITS)[Plan];

export const PLAN_PRICING = {
  pro_monthly: {
    label: "Pro monthly",
    amountCents: 999,            // $9.99/mo
    interval: "month" as const,
    currency: "usd",
    plan: "pro" as Plan,
  },
  pro_yearly: {
    label: "Pro yearly",
    amountCents: 9_900,          // $99/yr (~17% off monthly)
    interval: "year" as const,
    currency: "usd",
    plan: "pro" as Plan,
  },
};

export type PriceKey = keyof typeof PLAN_PRICING;

export function isUnlimited(n: number): boolean {
  return !Number.isFinite(n);
}

export function formatLimit(n: number): string {
  return isUnlimited(n) ? "Unlimited" : String(n);
}
