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
  // SEO routes: robots.txt + sitemap.xml MUST stay public on every
  // host. Without these in the allowlist, the middleware redirected
  // anonymous /robots.txt and /sitemap.xml requests to /login —
  // which broke Google's crawler ("Redirecting..." was the only body
  // crawlers saw). The host-aware logic for the bodies themselves
  // lives in app/robots.ts and app/sitemap.ts; this list is only
  // about whether the request gets through middleware at all.
  "/robots.txt",
  "/sitemap.xml",
  // Unauth splash for enterprise.taxottic.com root. Reached via a
  // middleware-side rewrite when an anonymous visitor hits
  // `enterprise.taxottic.com/`; the page itself is public so it can
  // also be linked to directly without an auth bounce. See the
  // `isEnterprise && pathname === "/" && !user` branch below.
  "/enterprise-welcome",
];

const HQ_HOST = "hq.taxottic.com";
const ENTERPRISE_HOST = "enterprise.taxottic.com";
const ROOT_DOMAIN = "taxottic.com";

// Subdomains we treat as reserved (NOT firm portals) — these short-
// circuit the wildcard logic and fall through to consumer / admin
// handling. `www` is canonicalized to the root; `dev`/`staging`/
// `preview` are environment buckets; `assets`/`cdn` are static.
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "hq",
  "enterprise",
  "dev",
  "staging",
  "preview",
  "assets",
  "cdn",
  "api",
  "mail",
  "email",
  "auth",
]);

// Headers we set when a firm subdomain is detected. Server components
// read these to resolve firm context without re-parsing the host on
// every page. The actual DB lookup (slug → firm record) happens in
// `lib/firm/context.ts`; middleware just sets the slug header so the
// page knows which firm to load.
const FIRM_SLUG_HEADER = "x-taxottic-firm-slug";
// Phase 2.5: BYO custom domain. When a firm has connected
// {their-domain}.com to their portal, middleware sets this header
// instead of the slug header; lib/firm/context.ts resolves the
// firm via firm_custom_domains lookup on the first server-component
// fetch.
const FIRM_CUSTOM_HOST_HEADER = "x-taxottic-firm-custom-host";

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
  // /sitemap.xml needs the same passthrough as /robots.txt so the
  // rewrite to /admin/sitemap.xml (which doesn't exist) doesn't
  // cascade into a /login redirect. The body itself is host-aware
  // in app/sitemap.ts and returns an empty list on admin hosts.
  "/sitemap.xml",
  // The enterprise unauth splash lives at /enterprise-welcome on
  // every host so the same component renders identically (see the
  // `isEnterprise && pathname === "/" && !user` rewrite below). On
  // the admin hosts we need to passthrough or the admin-host
  // rewrite (`/admin${pathname}`) would turn this into
  // `/admin/enterprise-welcome`, which doesn't exist.
  "/enterprise-welcome",
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

  // Wildcard subdomain detection.
  //
  // {slug}.taxottic.com → firm portal. The middleware extracts the
  // slug, sets x-taxottic-firm-slug header so server components can
  // read it without re-parsing host, and rewrites `/` to `/firm`
  // (the cockpit). Paths under /admin or /api etc. pass through so
  // a firm member can still hit super-admin tooling (gated by
  // role) and API routes work identically across hosts.
  //
  // We deliberately DON'T look up the firm in the DB from middleware
  // — that would add a Supabase round-trip to every request. The
  // firm-context resolver in lib/firm/context.ts does the lookup
  // lazily; if the slug doesn't match a real firm, the page renders
  // a "firm not found" panel and links to /firms/request-account.
  let firmSlugFromHost: string | null = null;
  let customFirmHost: string | null = null;
  if (
    host.endsWith(`.${ROOT_DOMAIN}`) &&
    !isHq &&
    !isEnterprise
  ) {
    const sub = host.slice(0, -(`.${ROOT_DOMAIN}`.length));
    // Multi-level subdomains (e.g. preview.smithcpa.taxottic.com)
    // aren't firm portals — only single-level subdomains are.
    if (
      sub.length >= 3 &&
      sub.length <= 32 &&
      !sub.includes(".") &&
      !RESERVED_SUBDOMAINS.has(sub) &&
      /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(sub)
    ) {
      firmSlugFromHost = sub;
    }
  } else if (
    host &&
    host !== ROOT_DOMAIN &&
    host !== `www.${ROOT_DOMAIN}` &&
    !host.endsWith(".vercel.app") &&
    !host.startsWith("localhost") &&
    !host.startsWith("127.") &&
    !host.endsWith(`.${ROOT_DOMAIN}`)
  ) {
    // Phase 2.5: BYO custom domain. Anything that's not a Taxottic
    // host AND isn't a preview / local dev address is a candidate
    // for a firm_custom_domains lookup. We set a header here; the
    // firm-context resolver in lib/firm/context.ts does the DB
    // hit lazily so the middleware stays Supabase-free.
    customFirmHost = host;
  }
  const isFirmHost = firmSlugFromHost !== null || customFirmHost !== null;

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
  } else if (isFirmHost) {
    // Firm subdomain OR custom BYO domain. Forward / to /firm
    // (the cockpit), set the appropriate header for the firm-context
    // resolver to pick the right firm.
    if (firmSlugFromHost) {
      request.headers.set(FIRM_SLUG_HEADER, firmSlugFromHost);
    }
    if (customFirmHost) {
      request.headers.set(FIRM_CUSTOM_HOST_HEADER, customFirmHost);
    }
    if (pathname === "/") {
      rewriteTo = request.nextUrl.clone();
      rewriteTo.pathname = "/firm";
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

  // enterprise.taxottic.com unauth splash. Without this, anonymous
  // visitors to the enterprise root were getting rewritten to
  // /admin/firms (above), which then redirected to /login — the
  // subdomain looked abandoned. The splash explains what the portal
  // is, surfaces Sign In + Book a Demo, and links back to the
  // consumer site. Resolves the May 2026 weekly audit's Critical #4.
  //
  // For authenticated users we keep the existing /admin/firms rewrite
  // so super-admins land directly in the firm-ops console.
  if (isEnterprise && pathname === "/" && !user) {
    const splash = request.nextUrl.clone();
    splash.pathname = "/enterprise-welcome";
    return NextResponse.rewrite(splash, { request });
  }

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
