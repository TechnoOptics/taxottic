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
    // Free plan caps at 1 company. Previously we threw which surfaced
    // as a generic error digest in the client (the "ERROR 933579909"
    // people saw). Redirect to /billing so the user lands somewhere
    // useful with the actual upgrade path.
    redirect("/billing?reason=company_limit");
  }

  const name = String(formData.get("name") ?? "").trim();
  const entityType = String(formData.get("entity_type") ?? "").trim();
  const stateCode = String(formData.get("state_code") ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  // Optional full_name comes through when the wizard collected the
  // user's display name on its first stage (the new "your details +
  // your company" merged flow). Treat as nullable so the action still
  // works for users creating their second / third company who already
  // have a name on file.
  const ownerName = String(formData.get("owner_full_name") ?? "")
    .trim()
    .slice(0, 120);

  if (!name) throw new Error("Name required");

  // Use service-role for the insert. RLS via auth.uid() doesn't reliably work
  // inside Next.js server actions with @supabase/ssr - the user's session
  // isn't always passed as the Authorization header on the PostgREST call,
  // so auth.uid() returns NULL and the WITH CHECK fails. We have already
  // validated the JWT above; created_by/user_id come from the trusted user
  // object so bypassing RLS for these inserts is safe.
  const admin = createServiceClient();

  // Backfill profiles.full_name from the wizard before creating the
  // company. Only writes when (a) the wizard supplied a value AND
  // (b) the user doesn't already have one set, so re-runs of this
  // flow don't clobber a name the user edited in /settings.
  if (ownerName) {
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    if (!existingProfile?.full_name) {
      await admin
        .from("profiles")
        .update({ full_name: ownerName })
        .eq("id", user.id);
    }
  }

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
