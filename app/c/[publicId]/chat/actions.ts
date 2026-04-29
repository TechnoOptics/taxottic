"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin } from "@/lib/auth";

/**
 * Post a message to a company's team chat. RLS would also block a
 * non-member, but we double-check at the action level so we can return
 * a clean error message instead of a Postgres-style RLS violation.
 */
export async function sendTeamMessage(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!companyId) throw new Error("Missing company");
  if (!body) throw new Error("Message is empty");
  if (body.length > 4000) {
    throw new Error("Message is over the 4,000-character limit");
  }

  // Membership check - cheaper than relying on RLS error decoding.
  const { data: membership } = await admin
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    throw new Error("Not a member of this company");
  }

  const { error } = await admin.from("team_messages").insert({
    company_id: companyId,
    user_id: user.id,
    body,
  });
  if (error) throw new Error(error.message);

  // The realtime subscription will pull the message into clients;
  // revalidate the path so a hard navigation also picks it up.
  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) revalidatePath(`/c/${company.public_id}/chat`);
}

/**
 * Delete a message. The RLS policy already enforces "own or manager",
 * but we run through the service-role client and re-check to keep the
 * error path readable.
 */
export async function deleteTeamMessage(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const companyId = String(formData.get("company_id") ?? "");
  const messageId = String(formData.get("message_id") ?? "");

  if (!companyId || !messageId) return;

  // Allow if the user authored it OR is a manager of the company.
  const [{ data: msg }, { data: membership }] = await Promise.all([
    admin
      .from("team_messages")
      .select("user_id, company_id")
      .eq("id", messageId)
      .maybeSingle(),
    admin
      .from("company_members")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (!msg || msg.company_id !== companyId) return;
  const isAuthor = msg.user_id === user.id;
  const isManager = membership?.role === "manager";
  if (!isAuthor && !isManager) {
    throw new Error("You can only delete your own messages.");
  }

  const { error } = await admin
    .from("team_messages")
    .delete()
    .eq("id", messageId);
  if (error) throw new Error(error.message);

  const { data: company } = await admin
    .from("companies")
    .select("public_id")
    .eq("id", companyId)
    .single();
  if (company) revalidatePath(`/c/${company.public_id}/chat`);
}
