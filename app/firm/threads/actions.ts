"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";
import { notify } from "@/lib/push";

export async function createThread(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const title = String(formData.get("title") ?? "").trim();
  const engagementId =
    String(formData.get("engagement_id") ?? "").trim() || null;
  if (!title || title.length > 200) {
    throw new Error("Title must be 1-200 characters.");
  }
  const { data: row, error } = await admin
    .from("firm_threads")
    .insert({
      firm_id: ctx.firm.id,
      engagement_id: engagementId,
      title,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !row) throw new Error(error?.message ?? "Insert failed.");
  redirect(`/firm/threads/${row.id}`);
}

export async function postMessage(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const threadId = String(formData.get("thread_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!threadId) throw new Error("Missing thread id.");
  if (!body || body.length > 8000) {
    throw new Error("Message must be 1-8000 characters.");
  }
  // Extract @mentions from body, pattern @{firstname.lastname} or
  // @email. For v1 we leave the array empty and let the UI parse
  // later; the column exists for future routing.
  const { data: msg, error } = await admin
    .from("firm_messages")
    .insert({
      thread_id: threadId,
      firm_id: ctx.firm.id,
      author_id: user.id,
      body,
    })
    .select("id")
    .single();
  if (error || !msg) throw new Error(error?.message ?? "Insert failed.");

  // Phase-3 producer: notify the other people on this thread (prior
  // authors + the thread starter, minus the sender). Wrapped so a
  // notification hiccup can never fail the message post itself.
  try {
    const [{ data: priorAuthors }, { data: thread }, { data: me }] =
      await Promise.all([
        admin
          .from("firm_messages")
          .select("author_id")
          .eq("thread_id", threadId),
        admin
          .from("firm_threads")
          .select("created_by")
          .eq("id", threadId)
          .maybeSingle(),
        admin
          .from("profiles")
          .select("full_name, email")
          .eq("id", user.id)
          .maybeSingle(),
      ]);
    const recipients = new Set<string>();
    for (const a of priorAuthors ?? []) {
      if (a.author_id && a.author_id !== user.id) recipients.add(a.author_id);
    }
    if (thread?.created_by && thread.created_by !== user.id) {
      recipients.add(thread.created_by);
    }
    const fromName =
      me?.full_name?.trim() || me?.email || "A teammate";
    for (const rid of recipients) {
      await notify(rid, {
        kind: "message",
        fromName,
        threadId,
        messageId: msg.id,
      });
    }
  } catch {
    /* posting succeeded; notification is best-effort */
  }

  revalidatePath(`/firm/threads/${threadId}`);
}

export async function archiveThread(formData: FormData) {
  const { admin } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing thread id.");
  await admin
    .from("firm_threads")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("firm_id", ctx.firm.id);
  revalidatePath(`/firm/threads`);
  redirect("/firm/threads");
}
