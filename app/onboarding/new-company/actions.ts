"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { checkCompanyLimit } from "@/lib/plans/usage";

export async function createCompany(formData: FormData) {
  const { supabase, user } = await requireUser();

  const limit = await checkCompanyLimit(supabase, user.id);
  if (!limit.ok) {
    throw new Error(
      "Free plan supports 1 company. Upgrade to Pro at /billing for unlimited companies.",
    );
  }

  const name = String(formData.get("name") ?? "").trim();
  const entityType = String(formData.get("entity_type") ?? "").trim();
  const stateCode = String(formData.get("state_code") ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 2);

  if (!name) throw new Error("Name required");

  const { data: company, error } = await supabase
    .from("companies")
    .insert({
      name,
      entity_type: entityType,
      state_code: stateCode,
      created_by: user.id,
    })
    .select("id, public_id")
    .single();

  if (error || !company) throw new Error(error?.message ?? "Insert failed");

  const { error: memberError } = await supabase
    .from("company_members")
    .insert({ company_id: company.id, user_id: user.id, role: "manager" });

  if (memberError) throw new Error(memberError.message);

  redirect(`/onboarding/tax-profile?next=/c/${company.public_id}/forecast`);
}
