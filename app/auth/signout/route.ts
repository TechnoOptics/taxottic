import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function handle(request: Request) {
  const supabase = await createClient();
  // signOut is a no-op if the user isn't signed in - safe regardless of state.
  await supabase.auth.signOut();
  const { origin } = new URL(request.url);
  // 303 forces the browser to GET /login regardless of the method that hit
  // this handler.
  return NextResponse.redirect(`${origin}/login`, { status: 303 });
}

// Accept both methods so that a stale session redirected here, a direct GET
// from typing the URL, or the normal form POST all do the right thing.
export const POST = handle;
export const GET = handle;
