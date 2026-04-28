"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { checkCompanyLimit } from "@/lib/plans/usage";

export async function createCompany(formData: FormData) {
  // requireUser validates the JWT via Supabase auth - we trust user.id below.
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

  // Use service-role for the insert. RLS via auth.uid() doesn't reliably work
  // inside Next.js server actions with @supabase/ssr - the user's session
  // isn't always passed as the Authorization header on the PostgREST call,
  // so auth.uid() returns NULL and the WITH CHECK fails. We have already
  // validated the JWT above; created_by/user_id come from the trusted user
  // object so bypassing RLS for these inserts is safe.
  const admin = createServiceClient();

  const { data: company, error } = await admin
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

  const { error: memberError } = await admin
    .from("company_members")
    .insert({ company_id: company.id, user_id: user.id, role: "manager" });

  if (memberError) throw new Error(memberError.message);

  redirect(`/onboarding/tax-profile?next=/c/${company.public_id}/forecast`);
}
