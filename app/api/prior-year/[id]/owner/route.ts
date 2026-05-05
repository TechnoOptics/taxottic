import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Re-tag an uploaded prior-year document as belonging to the user
 * (`self`) or their spouse (`spouse`). The apply step reads this to
 * split W-2 totals into owner vs spouse columns on the tax profile.
 *
 * Auth: the row's RLS policies restrict the update to the authenticated
 * user who uploaded the doc.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const raw = String(body?.forPerson ?? "");
  const forPerson: "self" | "spouse" = raw === "spouse" ? "spouse" : "self";

  const { error } = await supabase
    .from("prior_year_documents")
    .update({ for_person: forPerson })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, forPerson });
}
