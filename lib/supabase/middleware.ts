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
  // Conversion-critical marketing pages. Previously these redirected
  // through /login (the May 2026 audit's P1-6 + P2 cluster) — keeping
  // them public lets prospects evaluate Taxottic without creating an
  // account, which is what a 2026 B2B/SMB buyer expects.
  "/pricing",
  "/help",
  "/changelog",
  "/example",
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.ico",
  "/sw.js",
  "/account/suspended",
];

const HQ_HOST = "hq.taxottic.com";
const ENTERPRISE_HOST = "enterprise.taxottic.com";

// Paths that bypass the admin-host -> /admin URL rewrite. Auth flows
// must keep their canonical /auth/* URLs because the OAuth callback
// URL is pre-registered with Supabase + the providers; rewriting it
// would break the redirect contract. /api/* keeps its real path so
// server routes can be reached identically from any host. /_next is
// the Next.js asset pipeline.
const ADMIN_PASSTHROUGH_PREFIXES = [
  "/admin",
  "/auth",
  "/api",
  "/_next",
  "/login",
];
const ADMIN_PASSTHROUGH_EXACT = new Set([
  "/favicon.ico",
  "/icon.svg",
  "/manifest.webmanifest",
  "/sw.js",
  "/robots.txt",
]);

export async function updateSession(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  // Three portals on three real subdomains:
  //   - taxottic.com               → consumer app (default)
  //   - hq.taxottic.com            → super-admin overview at /admin
  //   - enterprise.taxottic.com    → firm-operator console at /admin/firms
  // Both admin subdomains share the same /admin/** route tree (one
  // codebase, scoped by the route's own requireSuperAdmin guard); the
  // middleware just picks which sub-tree the root URL of each subdomain
  // surfaces. May 2026: split Enterprise onto its own subdomain so
  // firm operators land in their console without seeing the HQ home.
  const isHq = host === HQ_HOST;
  const isEnterprise = host === ENTERPRISE_HOST;
  const isAdminHost = isHq || isEnterprise;
  const { pathname } = request.nextUrl;

  // Move admin off the customer domain — BUT only when the destination
  // subdomain is actually live. The NEXT_PUBLIC_*_HOST_LIVE env flags
  // (same contract as app/settings/actions.ts) tell us whether DNS +
  // Vercel + Supabase OAuth are wired for that subdomain yet.
  //
  // If we redirect to a subdomain that isn't live, the user hits
  // DNS_PROBE_FINISHED_NXDOMAIN with no recovery path. When the
  // destination isn't live, fall through — the /admin/** route renders
  // on the consumer host instead. Same code, same requireSuperAdmin
  // guard, no DNS dependency.
  //
  // /admin/firms and its children → enterprise.taxottic.com (when live)
  // everything else                 → hq.taxottic.com (when live)
  if (!isAdminHost && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    const stripped = pathname.replace(/^\/admin/, "") || "/";
    const goEnterprise =
      stripped === "/firms" || stripped.startsWith("/firms/");
    const hqLive = process.env.NEXT_PUBLIC_HQ_HOST_LIVE !== "false";
    const entLive = process.env.NEXT_PUBLIC_ENTERPRISE_HOST_LIVE === "true";
    const destinationLive = goEnterprise ? entLive : hqLive;
    if (destinationLive) {
      const targetHost = goEnterprise ? ENTERPRISE_HOST : HQ_HOST;
      const target = new URL(stripped, `https://${targetHost}`);
      target.search = request.nextUrl.search;
      return NextResponse.redirect(target, 308);
    }
    // Otherwise fall through and let the /admin/** page render here.
  }

  // On the admin subdomains, present the admin console at the root of
  // the domain (so URLs read hq.taxottic.com/users instead of
  // hq.taxottic.com/admin/users, and enterprise.taxottic.com/firms
  // instead of enterprise.taxottic.com/admin/firms). Internally we
  // still route to the /admin/* tree because that's where the pages
  // live.
  //
  // Per-host root: HQ defaults to /admin (the super-admin overview);
  // Enterprise defaults to /admin/firms (the firms console — what a
  // firm operator wants to see first).
  let rewriteTo: URL | null = null;
  if (isAdminHost) {
    const passthrough =
      ADMIN_PASSTHROUGH_PREFIXES.some(
        (p) => pathname === p || pathname.startsWith(`${p}/`),
      ) || ADMIN_PASSTHROUGH_EXACT.has(pathname);
    if (!passthrough) {
      rewriteTo = request.nextUrl.clone();
      if (pathname === "/") {
        rewriteTo.pathname = isEnterprise ? "/admin/firms" : "/admin";
      } else {
        rewriteTo.pathname = `/admin${pathname}`;
      }
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
    // Land at the host's natural home: consumer → /dashboard, HQ → /,
    // Enterprise → /. Both admin hosts use "/" because the rewrite
    // above turns it into the right /admin/** internal target.
    url.pathname = isAdminHost ? "/" : "/dashboard";
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

  // Strip any wildcard CORS the platform layer might have injected. The
  // May 2026 audit flagged `Access-Control-Allow-Origin: *` showing up
  // on both the consumer and HQ origins. That's appropriate for fully
  // public CDN assets, but on app responses it widens the blast radius
  // of any future endpoint that accidentally returns sensitive data on
  // the wrong route. We don't intend to allow cross-origin reads from
  // Taxottic at all, so we delete the header instead of narrowing it -
  // same-origin policy will then govern by default. If a specific API
  // route ever does need CORS (e.g., a public webhook receiver), it
  // should opt in by setting an explicit, narrow `Access-Control-Allow-
  // Origin` on its own response.
  response.headers.delete("Access-Control-Allow-Origin");
  response.headers.delete("Access-Control-Allow-Credentials");

  return response;
}
