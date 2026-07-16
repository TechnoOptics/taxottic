import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  isPersonalLocked,
  type MembershipRole,
} from "@/lib/entitlements/personal-access";

/**
 * Server-side resolution of the employee personal-hub lock. Reads the
 * caller's company roles + their own subscription and applies
 * isPersonalLocked. Returns { locked, userId } — locked is false for
 * signed-out callers (nothing to gate; the page's own auth guard runs).
 */
export async function getPersonalAccess(): Promise<{
  locked: boolean;
  userId: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { locked: false, userId: null };

  const [membershipRes, subRes] = await Promise.all([
    supabase.from("company_members").select("role").eq("user_id", user.id),
    supabase
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const roles = (membershipRes.data ?? []).map(
    (r) => r.role as MembershipRole,
  );
  const locked = isPersonalLocked({
    roles,
    plan: (subRes.data?.plan as string | null) ?? null,
    status: (subRes.data?.status as string | null) ?? null,
  });
  return { locked, userId: user.id };
}

/**
 * Guard for personal-workspace pages. Employee-only accounts without
 * their own paid plan are bounced to the personal upgrade upsell.
 */
export async function requirePersonalAccess(): Promise<void> {
  const { locked } = await getPersonalAccess();
  if (locked) redirect("/personal/upgrade");
}
