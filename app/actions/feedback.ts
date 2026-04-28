"use server";

import { requireUserWithAdmin } from "@/lib/auth";

export async function submitFeedback(formData: FormData) {
  const { admin, user } = await requireUserWithAdmin();
  const kind = String(formData.get("kind") ?? "other");
  const subject = String(formData.get("subject") ?? "").trim() || null;
  const body = String(formData.get("body") ?? "").trim();
  const pageUrl = String(formData.get("page_url") ?? "").trim() || null;
  const userAgent = String(formData.get("user_agent") ?? "").trim() || null;
  if (!body) throw new Error("Tell us a little something.");

  const { error } = await admin.from("feedback").insert({
    user_id: user.id,
    email: user.email ?? null,
    kind,
    subject,
    body,
    page_url: pageUrl,
    user_agent: userAgent,
  });
  if (error) throw new Error(error.message);
}
