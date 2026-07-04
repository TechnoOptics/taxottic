import { Wordmark } from "./Wordmark";
import { UserMenu } from "./UserMenu";
import { GdprBanner } from "./GdprBanner";
import { WebOnly } from "./WebOnly";
import { DarkThemeMount } from "./DarkThemeMount";
import { LeftRail } from "./LeftRail";
import { LeftRailMobile } from "./LeftRailMobile";
import { SmartSearch } from "./SmartSearch";
import { OutstandingTasksBell } from "./OutstandingTasksBell";
import { createClient } from "@/lib/supabase/server";
import { recordGdprConsent } from "@/app/actions/consent";
import { submitFeedback } from "@/app/actions/feedback";
import { setActivePlatform, setPreviewPlan } from "@/app/settings/actions";
import { getActiveFeatureGates, asPlanOrNull } from "@/lib/plans/usage";
import type { Plan } from "@/lib/plans/limits";
import { PlanPreviewBanner } from "./PlanPreviewBanner";
import { getMyCompanies, isSuperAdminCached } from "@/lib/auth";
import { getOutstandingTasks, type OutstandingItem } from "@/lib/tasks/outstanding";

type AppHeaderProps = {
  email?: string;
  bellaCompanyId?: string;
  // Where the wordmark links to. Defaults to /dashboard for the
  // customer app; admin pages on hq.taxottic.com pass "/" so the
  // wordmark goes to the admin home (which middleware rewrites to
  // /admin internally).
  homeHref?: string;
  // Reserved for future use; kept on the prop signature so existing
  // callers don't break. The capture deterrent stack was pulled out
  // after a demo regression - consider re-introducing only when we
  // can scope it more carefully (e.g., opt-in per page).
  allowPrint?: boolean;
};

export async function AppHeader({
  email,
  bellaCompanyId,
  homeHref = "/dashboard",
  allowPrint: _allowPrint = false,
}: AppHeaderProps) {
  // Pull profile + super-admin state + active platform. Used to wire
  // the user-menu dropdown's portal switcher (super-admins can jump
  // between Consumer / Enterprise / HQ from the dropdown) and to mark
  // the current platform with a "Current" pill.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let fullName: string | null = null;
  let avatarUrl: string | null = null;
  let needsConsent = false;
  let bellaEnabled = false;
  let showSmartSearch = false;
  let isSuperAdmin = false;
  let currentPlatform: "user" | "enterprise" | "hq" = "user";
  let activeCompanyId: string | null = null;
  let previewPlan: Plan | null = null;
  // The header's per-user reads all depend only on the validated user id,
  // so fan them out concurrently instead of awaiting in series (was
  // profile → gates → super-admin → memberships, ~4 sequential round
  // trips). getActiveFeatureGates and isSuperAdminCached both resolve
  // is_super_admin, but React cache() collapses that to a single RPC even
  // under concurrency. Memberships feed the LeftRail switcher + the
  // outstanding-tasks company resolution below, and are consumer-surface
  // only (admin/HQ hosts render no rail, so we skip that fetch).
  let memberships: Awaited<ReturnType<typeof getMyCompanies>> = [];
  if (user) {
    const [profile, gatesResult, superAdmin, myCompanies] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "full_name, avatar_url, gdpr_consented_at, active_platform, show_smart_search, active_company_id, preview_plan",
        )
        .eq("id", user.id)
        .maybeSingle()
        .then((r) => r.data),
      getActiveFeatureGates(supabase, user.id),
      isSuperAdminCached(),
      homeHref === "/"
        ? Promise.resolve<Awaited<ReturnType<typeof getMyCompanies>>>([])
        : getMyCompanies(),
    ]);

    fullName = profile?.full_name ?? null;
    avatarUrl = profile?.avatar_url ?? null;
    needsConsent = !profile?.gdpr_consented_at;
    activeCompanyId = (profile?.active_company_id as string | null) ?? null;
    const rawPlatform = (profile?.active_platform as string | null) ?? "user";
    if (
      rawPlatform === "user" ||
      rawPlatform === "enterprise" ||
      rawPlatform === "hq"
    ) {
      currentPlatform = rawPlatform;
    }
    bellaEnabled = gatesResult.gates.bella;
    // Smart search is OFF by default; the user opts in from
    // /settings → Header. Treat null/undefined as false too, so a
    // fresh install or a row created before the column existed
    // doesn't silently render the search input.
    showSmartSearch = profile?.show_smart_search === true;
    // Non-super-admins won't see the portal switcher at all, it's not
    // disabled-and-hidden, it's structurally absent.
    isSuperAdmin = superAdmin;
    // QA plan preview is a super-admin-only tool; only surface the
    // pinned tier (and the banner) for them so a stray column value
    // could never affect a normal user's chrome.
    if (isSuperAdmin) {
      previewPlan = asPlanOrNull(profile?.preview_plan);
    }
    memberships = myCompanies;
  }

  const companies = memberships.map((m) => ({
    publicId: m.company.public_id,
    name: m.company.name,
    role: m.role,
  }));

  // Outstanding tasks (unclassified drives + transactions awaiting a
  // business/personal or category call). Follows the same "active
  // company" resolution as the watch snapshot endpoint: the company
  // the user was last looking at, falling back to their first
  // membership, and never trusting a stale active_company_id the user
  // no longer belongs to. Consumer surfaces only (admin/HQ has no
  // per-company tasks to surface).
  let outstanding: { items: OutstandingItem[]; count: number } = {
    items: [],
    count: 0,
  };
  if (user && homeHref !== "/") {
    const belongs = activeCompanyId
      ? memberships.some((m) => m.company.id === activeCompanyId)
      : false;
    const active = belongs
      ? memberships.find((m) => m.company.id === activeCompanyId)
      : memberships[0];
    try {
      outstanding = await getOutstandingTasks(supabase, {
        userId: user.id,
        companyId: active?.company.id ?? null,
        companyPublicId: active?.company.public_id ?? null,
      });
    } catch {
      /* outstanding-tasks tally is best-effort, never break the header */
    }
  }

  return (
    <>
      {/* Set the theme SYNCHRONOUSLY before the page paints so the
          rail-clearance CSS (html[data-theme] main) applies on the first
          layout, otherwise there's a flash where the fixed rail overlaps
          the content before DarkThemeMount's effect runs. Authenticated
          pages only (this header renders only here). */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "try{var t=localStorage.getItem('taxottic.theme');document.documentElement.dataset.theme=(t==='dark'?'dark':'light');}catch(e){document.documentElement.dataset.theme='light';}",
        }}
      />
      {/* Skip-to-main-content link. Visually hidden until focused so
          keyboard + screen-reader users can jump straight to the page
          content without tabbing through the wordmark / UserMenu /
          portal-switcher / Bella FAB stack every time. Pairs with the
          `id="main"` we set on every <main> below; for pages whose
          <main> doesn't have that id, the browser scrolls to the
          top instead, still better than nothing.
          Added in response to the May 2026 weekly audit (Quick Win
          #4: "Skip to main content"). */}
      <a
        href="#main"
        className="
          sr-only focus:not-sr-only
          focus:fixed focus:top-2 focus:left-2 focus:z-50
          focus:rounded-md focus:bg-forest-900 focus:text-cream
          focus:px-3 focus:py-2 focus:text-sm focus:font-medium
          focus:outline-none focus:ring-2 focus:ring-gold-400
        "
      >
        Skip to main content
      </a>
      {/* Sticky header (was `fixed` pre-May 2026). `sticky top-0` keeps
          the header pinned to the viewport top once it scrolls into
          view but lets it participate in normal layout, so we no
          longer need the spacer div that used to push content down.
          Pattern borrowed from Advottic for cross-product cohesion. */}
      {/* position: FIXED, not sticky. `sticky` repeatedly failed in
          the Capacitor WebView, it breaks if ANY ancestor has
          overflow != visible, and we need overflow-x:clip on
          html/body to stop horizontal scroll. A fixed header's
          containing block is the viewport, so it is immune to
          ancestor overflow AND lets us clip horizontal overflow
          safely. A constant-height spacer below replaces the layout
          space the in-flow header used to occupy (no scroll-shrink,
          so the spacer always matches exactly). */}
      <header
        className="app-header fixed top-0 left-0 right-0 z-30"
        style={{
          // Safe-area handling, pick the LARGER of the Capacitor
          // override (--app-safe-top, set by CapacitorNativeInit per
          // OS) and the platform env() inset. Previously the var()
          // default-shadowing meant a Capacitor app that set
          // --app-safe-top:0 (edge-to-edge opt-out path) would NEVER
          // fall through to env(), so devices where the opt-out
          // misbehaves (some Android OEM skins, foldables with
          // dynamic status bars) had the header slip under the system
          // strip. max() gives whichever signal is larger, so the
          // header always clears the OS chrome regardless of which
          // path is reporting accurate insets.
          paddingTop:
            "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {/* Header content row. On lg+ the LeftRail occupies the
            first 232px (left-2 + w-56) of the viewport, so we
            left-pad the row by 15rem (240px = rail width + 8px gap)
            so the wordmark sits cleanly to the right of the rail
            instead of being hidden behind it. The rail is at z-40
            and the header is z-30, so without this pad the rail's
            card would draw on top of the wordmark. On < lg the rail
            is hidden (LeftRailMobile is a floating tab) so pl-0
            keeps the header content full-width with the wordmark at
            the left edge as before. */}
        {/* Header content row scales with the viewport.
            Width:     max-w-6xl (1152px) on small/medium,
                       max-w-7xl (1280px) on xl, no cap on 2xl so a
                       27" monitor uses the whole viewport instead
                       of stranding 600px of empty side margin.
            Height:    h-[3.25rem] (52px) on phone, touch ergonomics
                       are fine there; bumps to h-14 (56px) on lg
                       and h-16 (64px) on xl so the brand strip
                       reads at a desktop scale.
            Left pad:  lg:pl-60 / xl:pl-64 / 2xl:pl-72 matches the
                       LeftRail's width steps so the wordmark stays
                       clear of the rail at every breakpoint. */}
        {/* Full-bleed header on lg+. User feedback (May 25 2026):
            "the profile icon is all the way to the right if the
            taxottic logo does not start left." The previous
            max-w + mx-auto centered the header content in a box,
            so on a wide monitor the wordmark sat with empty space
            to its LEFT and the user menu sat with empty space to
            its RIGHT, visually disconnected from the actual
            viewport edges. Now: drop max-w + mx-auto entirely on
            lg+; the row spans edge-to-edge with lg:pl-N for rail
            clearance and a small lg:pr-N for the user-menu
            breathing room. Mobile stays max-w/mx-auto because the
            mobile sheet menu hamburger has its own anchor logic. */}
        <div className="app-header-row max-w-6xl mx-auto lg:max-w-none lg:mx-0 px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:pr-6 h-[3.25rem] lg:h-14 xl:h-16 flex items-center gap-3 relative">
          {/* Consumer surface only: hamburger that opens the same
              left rail in a sheet on < lg widths. Admin / HQ host
              still renders only the wordmark + UserMenu pair. */}
          {homeHref !== "/" ? <LeftRailMobile companies={companies} /> : null}
          <Wordmark href={homeHref} size="sm" tone="cream" />
          {/* Smart search powered by Bella. OPT-IN per user via
              /settings (profile.show_smart_search). When on, it
              sits centered between the wordmark and the user menu
              on lg+ screens; on `< lg` widths it's hidden from the
              header entirely so the mobile top bar stays uncluttered
, the user can still hit the search from the full Bella
              chat page. Default off keeps the header light for users
              who don't use Bella daily. */}
          {homeHref !== "/" && bellaEnabled && showSmartSearch ? (
            <div className="hidden lg:flex flex-1 justify-center">
              <SmartSearch companyPublicId={bellaCompanyId} />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          {homeHref !== "/" ? (
            <OutstandingTasksBell
              count={outstanding.count}
              items={outstanding.items}
            />
          ) : null}
          <UserMenu
            email={email ?? null}
            fullName={fullName}
            avatarUrl={avatarUrl}
            adminMode={homeHref === "/"}
            isSuperAdmin={isSuperAdmin}
            currentPlatform={currentPlatform}
            setPlatformAction={setActivePlatform}
            submitFeedbackAction={submitFeedback}
            previewPlan={previewPlan}
            setPreviewPlanAction={setPreviewPlan}
          />
        </div>
      </header>
      {/* QA plan preview reminder, only when a super-admin has pinned a
          lower tier than the default 'practice'. */}
      {isSuperAdmin && previewPlan && previewPlan !== "practice" ? (
        <PlanPreviewBanner plan={previewPlan} resetAction={setPreviewPlan} />
      ) : null}
      {/* Spacer matches the fixed header's height (safe-area inset
          + the 3.25rem single row). The header is now always a
          single row at every width, smart search is opt-in and
          only renders on lg+ when enabled, so there's never a
          mobile second-row search that needs extra spacer height
          (that mismatch was the May 2026 "header overlaps body"
          report). */}
      {/* Spacer must match the header's actual rendered height at
          each breakpoint or content slips under the fixed header.
          The header is h-[3.25rem] on small, lg:h-14 (56px), and
          xl:h-16 (64px). The CSS var --app-header-h is set globally
          via a small media-query block in globals.css so we don't
          have to duplicate the breakpoint math in every consumer. */}
      <div
        aria-hidden="true"
        style={{
          height:
            "calc(max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px)) + var(--app-header-h, 3.25rem))",
        }}
      />
      {/* Desktop left rail. Hidden on `< lg` widths (LeftRailMobile
          handles those via the hamburger). Consumer surfaces only -
          admin / HQ host doesn't get it because the rail's items
          don't apply. */}
      {homeHref !== "/" ? <LeftRail mode="rail" companies={companies} /> : null}
      {/* Flip <html data-theme="dark"> for the duration of any
          authenticated page render. Public marketing routes don't
          mount <AppHeader> so they stay light by default. See
          components/DarkThemeMount.tsx for the full story. */}
      <DarkThemeMount />
      {/* The Bella (bottom-right) and Studio-family (bottom-left)
          floating circles were removed per product direction, they
          cluttered the bottom of every screen. Bella can be
          re-surfaced from the UserMenu dropdown later if wanted, the
          same way "Send feedback" was relocated there. */}
      {/* Item 13: GDPR consent is folded into the legal acknowledgement, so
          it is never a separate banner in the mobile app. On web it stays as
          a fallback for accounts created before the fold. */}
      {needsConsent ? (
        <WebOnly>
          <GdprBanner acceptAction={recordGdprConsent} />
        </WebOnly>
      ) : null}
    </>
  );
}
