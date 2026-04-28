import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/**
 * Server-action helper. Returns the validated user plus a service-role
 * client. Necessary because @supabase/ssr's session cookies don't reliably
 * propagate to PostgREST queries from inside Next.js server actions on
 * production (auth.uid() returns NULL → RLS WITH CHECK fails).
 *
 * Safe pattern: trust user.id from the validated JWT, then perform writes
 * with the admin client (bypasses RLS). Always include user_id / created_by
 * = user.id in the inserted row. Never use admin to act on behalf of an
 * unvalidated identity.
 */
export async function requireUserWithAdmin() {
  const { supabase, user } = await requireUser();
  const admin = createServiceClient();
  return { supabase, user, admin };
}

export async function requireSuperAdmin() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase.rpc("is_super_admin");
  if (error || !data) redirect("/dashboard");
  return { supabase, user };
}

export type CompanyMembership = {
  company_id: string;
  role: "manager" | "member";
  company: {
    id: string;
    public_id: string;
    name: string;
  };
};

export async function getMyCompanies(): Promise<CompanyMembership[]> {
  const supabase = (await createClient());
  const { data } = await supabase
    .from("company_members")
    .select("company_id, role, company:companies(id, public_id, name)")
    .order("joined_at", { ascending: true });
  return (data ?? []) as unknown as CompanyMembership[];
}
