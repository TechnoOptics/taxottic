import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Exclude .well-known so vendor verification files (Microsoft identity
  // association, Apple app-site-association, etc.) can be fetched without
  // hitting the auth redirect.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
