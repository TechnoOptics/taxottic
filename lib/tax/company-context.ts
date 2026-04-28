import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";

export type CompanyRow = {
  id: string;
  public_id: string;
  name: string;
  entity_type: string | null;
  state_code: string | null;
};

export async function loadCompanyByPublicId(publicId: string) {
  const { supabase, user } = await requireUser();
  const { data: company } = await supabase
    .from("companies")
    .select("id, public_id, name, entity_type, state_code")
    .eq("public_id", publicId)
    .single<CompanyRow>();
  if (!company) notFound();

  const { data: membership } = await supabase
    .from("company_members")
    .select("role")
    .eq("company_id", company.id)
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    supabase,
    user,
    company,
    isManager: membership?.role === "manager",
  };
}
