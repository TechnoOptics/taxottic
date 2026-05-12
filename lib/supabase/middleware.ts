import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/auth/callback",
  "/auth/confirm",
  "/auth/signout",
  "/invite",
  "/legal",
  "/book",
  "/firms",
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.ico",
  "/sw.js",
  "/account/suspended",
];

const HQ_HOST = "hq.taxottic.com";

// Paths that bypass the hq->admin URL rewrite. Auth flows must keep
// their canonical /auth/* URLs because the OAuth callback URL is
// pre-registered with Supabase + the providers; rewriting it would
// break the redirect contract. /api/* keeps its real path so server
// routes can be reached identically from either host. /_next is the
// Next.js asset pipeline.
const HQ_PASSTHROUGH_PREFIXES = [
  "/admin",
  "/auth",
  "/api",
  "/_next",
  "/login",
];
const HQ_PASSTHROUGH_EXACT = new Set([
  "/favicon.ico",
  "/icon.svg",
  "/manifest.webmanifest",
  "/sw.js",
  "/robots.txt",
]);

export async function updateSession(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const isHq = host === HQ_HOST;
  const { pathname } = request.nextUrl;

  // Move admin off the customer domain. If a user (or stale bookmark)
  // hits /admin/* on taxottic.com, send them to hq.taxottic.com with
  // the /admin prefix dropped - the rewrite below puts them back on
  // the right page once they land.
  if (!isHq && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    const target = new URL(
      pathname.replace(/^\/admin/, "") || "/",
      `https://${HQ_HOST}`,
    );
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target, 308);
  }

  // On hq.taxottic.com, present the admin console at the root of the
  // domain (so URLs read hq.taxottic.com/firms instead of
  // hq.taxottic.com/admin/firms). Internally we still route to the
  // /admin/* tree because that's where the pages live.
  let rewriteTo: URL | null = null;
  if (isHq) {
    const passthrough =
      HQ_PASSTHROUGH_PREFIXES.some(
        (p) => pathname === p || pathname.startsWith(`${p}/`),
      ) || HQ_PASSTHROUGH_EXACT.has(pathname);
    if (!passthrough) {
      rewriteTo = request.nextUrl.clone();
      rewriteTo.pathname =
        pathname === "/" ? "/admin" : `/admin${pathname}`;
    }
  }

  let response = rewriteTo
    ? NextResponse.rewrite(rewriteTo, { request })
    : NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = rewriteTo
            ? NextResponse.rewrite(rewriteTo, { request })
            : NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The auth gate runs against the *internal* path (the page that's
  // about to render), so a hq.taxottic.com/firms request sees /admin
  // here and the admin layer's own requireSuperAdmin handles the role
  // check. Public paths use the public list as before.
  const internalPath = rewriteTo ? rewriteTo.pathname : pathname;

  // API routes handle their own auth + status codes. Middleware redirects
  // would break webhooks (e.g., Stripe) and JSON clients (302 to /login is
  // useless to a fetch caller).
  if (internalPath.startsWith("/api/")) {
    return response;
  }

  // On hq, anything that resolves to /admin/* is gated by
  // requireSuperAdmin in the page itself - middleware just makes sure
  // a session exists. Treat /login as public so unsigned visitors can
  // sign in on hq.taxottic.com directly.
  const isPublic = PUBLIC_PATHS.some(
    (p) => internalPath === p || internalPath.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Bookmarkable next: pass the user-visible path, not the rewritten
    // /admin/... internal one, so the post-login redirect lands on the
    // hq host's clean URL.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && internalPath === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = isHq ? "/" : "/dashboard";
    return NextResponse.redirect(url);
  }

  // Defense in depth against cross-tenant cache leaks: any response we
  // serve to an authenticated user must not be stored in the browser
  // bfcache or any intermediary cache. Without this, hitting Back after a
  // logout/login cycle restores the previous user's rendered HTML even
  // though cookies have rotated, and CDNs (or service workers) could
  // serve one user's RSC payload to another. Public anonymous traffic is
  // left untouched so static and marketing routes stay cacheable.
  if (user) {
    response.headers.set(
      "Cache-Control",
      "private, no-store, must-revalidate",
    );
  }

  return response;
}
