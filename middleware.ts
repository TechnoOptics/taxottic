import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Exclude .well-known so vendor verification files (Microsoft identity
  // association, Apple app-site-association, etc.) can be fetched without
  // hitting the auth redirect. llms.txt is likewise a public, crawler-
  // facing file — without this exclusion the auth middleware 307s it to
  // /login, so AI crawlers and search bots hit a wall instead of the
  // product summary. (robots.txt / sitemap.xml are app routes already
  // allow-listed in updateSession; llms.txt is a static public/ file.)
  // google<hash>.html are Google Search Console site-verification files
  // served from public/. Like llms.txt they must bypass the auth
  // redirect so Google's verifier (unauthenticated) can fetch them.
  // ...and any root-level *.txt (llms.txt, robots already a route, and
  // the IndexNow key file <hex>.txt) so unauthenticated verifiers /
  // crawlers can fetch them instead of being 307'd to /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|google[a-z0-9]+\\.html|\\.well-known/.*|[^/]+\\.txt$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
