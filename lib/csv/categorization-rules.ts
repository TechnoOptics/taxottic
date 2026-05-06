/**
 * Categorization rules — Bella's memory.
 *
 * Each rule is "every time you see <pattern> in a transaction
 * description, treat it as <kind> with <category_code>". Rules fire
 * BEFORE Anthropic so repeat vendors are categorized for free and
 * instantly. The user creates rules from the import-review page via
 * "Teach Bella" — also automatically created when the user manually
 * applies a transaction (we offer "Save as a rule?").
 *
 * Pattern matching is intentionally simple: exact, contains, or
 * starts_with. No regex (security + UX), no NLP. The user picks the
 * exact matcher when they teach the rule.
 *
 * Scope priority on lookup:
 *   1. Company-scoped rules win (more specific)
 *   2. User-global rules (no company_id) used as fallback
 *   3. Anything not matched falls through to Bella's Anthropic call
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type RulePatternType = "exact" | "contains" | "starts_with";
export type RuleKind = "expense" | "income" | "ignore" | "transfer";

export type CategorizationRule = {
  id: string;
  user_id: string;
  company_id: string | null;
  pattern_type: RulePatternType;
  pattern: string;
  kind: RuleKind;
  category_code: string | null;
  notes: string | null;
  hits: number;
  last_used_at: string | null;
};

export type RuleMatch = {
  rule: CategorizationRule;
  kind: RuleKind;
  code: string | null;
};

/**
 * Load all rules for a user — both company-scoped and user-global.
 * Sorted by pattern length (longer = more specific match) and
 * recency. Single query; we filter in memory.
 */
export async function loadRules(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<CategorizationRule[]> {
  const { data } = await admin
    .from("categorization_rules")
    .select("*")
    .eq("user_id", userId)
    .or(`company_id.eq.${companyId},company_id.is.null`);
  const rules = (data ?? []) as CategorizationRule[];
  // Specificity ordering: company-scoped beats global; longer pattern
  // beats shorter; exact beats starts_with beats contains.
  return rules.sort((a, b) => {
    const aCompany = a.company_id ? 1 : 0;
    const bCompany = b.company_id ? 1 : 0;
    if (aCompany !== bCompany) return bCompany - aCompany;
    const aType = patternTypeRank(a.pattern_type);
    const bType = patternTypeRank(b.pattern_type);
    if (aType !== bType) return aType - bType;
    return b.pattern.length - a.pattern.length;
  });
}

/**
 * Match a single transaction description against the rule list.
 * Returns the first matching rule or null.
 */
export function matchRule(
  description: string,
  rules: CategorizationRule[],
): RuleMatch | null {
  const haystack = (description ?? "").toLowerCase();
  for (const r of rules) {
    const needle = r.pattern.toLowerCase();
    if (matches(haystack, needle, r.pattern_type)) {
      return { rule: r, kind: r.kind, code: r.category_code };
    }
  }
  return null;
}

/**
 * Bump the hit counter + last_used_at for rules that fired during a
 * batch. Done in one query.
 */
export async function recordRuleHits(
  admin: SupabaseClient,
  ruleIds: string[],
): Promise<void> {
  if (ruleIds.length === 0) return;
  const now = new Date().toISOString();
  // Postgres doesn't have a clean bulk-increment in the JS client;
  // loop, but cap to a few dozen rules per import.
  for (const id of ruleIds) {
    await admin
      .from("categorization_rules")
      .update({
        hits: (await getCurrentHits(admin, id)) + 1,
        last_used_at: now,
      })
      .eq("id", id);
  }
}

async function getCurrentHits(
  admin: SupabaseClient,
  id: string,
): Promise<number> {
  const { data } = await admin
    .from("categorization_rules")
    .select("hits")
    .eq("id", id)
    .maybeSingle();
  return (data as { hits: number } | null)?.hits ?? 0;
}

/**
 * Create a rule. Idempotent on (user_id, company_id, pattern_type,
 * pattern) — re-teaching the same vendor just updates the kind/code.
 */
export async function upsertRule(
  admin: SupabaseClient,
  args: {
    userId: string;
    companyId: string | null;
    patternType: RulePatternType;
    pattern: string;
    kind: RuleKind;
    categoryCode: string | null;
    notes?: string | null;
  },
): Promise<CategorizationRule> {
  const { data: existing } = await admin
    .from("categorization_rules")
    .select("*")
    .eq("user_id", args.userId)
    .eq("pattern_type", args.patternType)
    .eq("pattern", args.pattern)
    .maybeSingle();

  if (existing) {
    const { data: updated } = await admin
      .from("categorization_rules")
      .update({
        kind: args.kind,
        category_code: args.categoryCode,
        notes: args.notes ?? null,
      })
      .eq("id", (existing as { id: string }).id)
      .select("*")
      .single();
    return updated as CategorizationRule;
  }

  const { data: created } = await admin
    .from("categorization_rules")
    .insert({
      user_id: args.userId,
      company_id: args.companyId,
      pattern_type: args.patternType,
      pattern: args.pattern,
      kind: args.kind,
      category_code: args.categoryCode,
      notes: args.notes ?? null,
    })
    .select("*")
    .single();
  return created as CategorizationRule;
}

function matches(
  haystack: string,
  needle: string,
  type: RulePatternType,
): boolean {
  switch (type) {
    case "exact":
      return haystack.trim() === needle;
    case "starts_with":
      return haystack.startsWith(needle);
    case "contains":
      return haystack.includes(needle);
  }
}

function patternTypeRank(type: RulePatternType): number {
  return { exact: 0, starts_with: 1, contains: 2 }[type];
}
