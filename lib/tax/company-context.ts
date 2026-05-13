import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";

export type CompanyRow = {
  id: string;
  public_id: string;
  name: string;
  entity_type: string | null;
  state_code: string | null;
  logo_url: string | null;
};

export async function loadCompanyByPublicId(publicId: string) {
  const { supabase, user } = await requireUser();
  // .is("deleted_at", null) — companies in the recycle bin look like
  // a 404 to every /c/[publicId]/* page so users can't accidentally
  // edit data on a company they meant to delete. The recycle bin UI
  // is the only place they should see soft-deleted companies; from
  // there they can either Restore (which clears deleted_at) or
  // Permanently delete.
  const { data: company } = await supabase
    .from("companies")
    .select("id, public_id, name, entity_type, state_code, logo_url")
    .eq("public_id", publicId)
    .is("deleted_at", null)
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
