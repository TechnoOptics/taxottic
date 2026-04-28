import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
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
