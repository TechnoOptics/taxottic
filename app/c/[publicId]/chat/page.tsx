import { redirect } from "next/navigation";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";

type Params = Promise<{ publicId: string }>;

/**
 * Top-level chat route just bounces into the company's default
 * "General" channel. Every company has one (auto-seeded by trigger),
 * so this should always have a target.
 */
export default async function ChatLandingPage({
  params,
}: {
  params: Params;
}) {
  const { publicId } = await params;
  const { supabase, company } = await loadCompanyByPublicId(publicId);

  const { data: defaultChannel } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("company_id", company.id)
    .eq("is_default", true)
    .maybeSingle();

  if (defaultChannel) {
    redirect(`/c/${publicId}/chat/${defaultChannel.id}`);
  }

  // Extremely rare fallback: trigger somehow didn't fire. Pick any
  // channel the user can see; if none, just bounce to forecast.
  const { data: any } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("company_id", company.id)
    .eq("kind", "channel")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (any) redirect(`/c/${publicId}/chat/${any.id}`);
  redirect(`/c/${publicId}/forecast`);
}
