import { Wordmark } from "./Wordmark";
import { UserMenu } from "./UserMenu";
import { GdprBanner } from "./GdprBanner";
import { DarkThemeMount } from "./DarkThemeMount";
import { LeftRail } from "./LeftRail";
import { LeftRailMobile } from "./LeftRailMobile";
import { SmartSearch } from "./SmartSearch";
import { createClient } from "@/lib/supabase/server";
import { recordGdprConsent } from "@/app/actions/consent";
import { submitFeedback } from "@/app/actions/feedback";
import { setActivePlatform } from "@/app/settings/actions";
import { getActiveFeatureGates } from "@/lib/plans/usage";

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
  let isSuperAdmin = false;
  let currentPlatform: "user" | "enterprise" | "hq" = "user";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, avatar_url, gdpr_consented_at, active_platform")
      .eq("id", user.id)
      .maybeSingle();
    fullName = profile?.full_name ?? null;
    avatarUrl = profile?.avatar_url ?? null;
    needsConsent = !profile?.gdpr_consented_at;
    const rawPlatform = (profile?.active_platform as string | null) ?? "user";
    if (
      rawPlatform === "user" ||
      rawPlatform === "enterprise" ||
      rawPlatform === "hq"
    ) {
      currentPlatform = rawPlatform;
    }
    const { gates } = await getActiveFeatureGates(supabase, user.id);
    bellaEnabled = gates.bella;
    // Resolve super-admin via the seeded helper so the menu only
    // shows the portal switcher to users who can actually use it.
    // Non-super-admins won't see the section at all - it's not
    // disabled-and-hidden, it's structurally absent.
    const { data: sa } = await supabase.rpc("is_super_admin");
    isSuperAdmin = Boolean(sa);
  }

  return (
    <>
      {/* Skip-to-main-content link. Visually hidden until focused so
          keyboard + screen-reader users can jump straight to the page
          content without tabbing through the wordmark / UserMenu /
          portal-switcher / Bella FAB stack every time. Pairs with the
          `id="main"` we set on every <main> below; for pages whose
          <main> doesn't have that id, the browser scrolls to the
          top instead — still better than nothing.
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
          view but lets it participate in normal layout — so we no
          longer need the spacer div that used to push content down.
          Pattern borrowed from Advottic for cross-product cohesion. */}
      {/* position: FIXED, not sticky. `sticky` repeatedly failed in
          the Capacitor WebView — it breaks if ANY ancestor has
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
          // iOS: env(safe-area-inset-top) clears the notch. Android:
          // CapacitorNativeInit sets --app-safe-top:0 (the OS already
          // reserves the status-bar strip via the edge-to-edge
          // opt-out), so it sits tight under the status bar.
          paddingTop: "var(--app-safe-top, env(safe-area-inset-top, 0px))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="app-header-row max-w-6xl mx-auto px-4 sm:px-6 h-[3.25rem] flex items-center gap-3 relative">
          {/* Consumer surface only: hamburger that opens the same
              left rail in a sheet on < lg widths. Admin / HQ host
              still renders only the wordmark + UserMenu pair. */}
          {homeHref !== "/" ? <LeftRailMobile /> : null}
          <Wordmark href={homeHref} size="sm" tone="cream" />
          {/* Smart search powered by Bella. Centered between the
              wordmark and the user menu on lg+ screens; on smaller
              widths it drops below into a second header row so the
              top bar isn't crammed. Bella is feature-gated, so we
              only mount it when the user actually has it. */}
          {homeHref !== "/" && bellaEnabled ? (
            <div className="hidden lg:flex flex-1 justify-center">
              <SmartSearch companyPublicId={bellaCompanyId} />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <UserMenu
            email={email ?? null}
            fullName={fullName}
            avatarUrl={avatarUrl}
            adminMode={homeHref === "/"}
            isSuperAdmin={isSuperAdmin}
            currentPlatform={currentPlatform}
            setPlatformAction={setActivePlatform}
            submitFeedbackAction={submitFeedback}
          />
        </div>
        {/* Second row for the search bar on < lg widths. Keeps the
            search prominent on phones without cramming it into the
            top row alongside the hamburger + wordmark + avatar. */}
        {homeHref !== "/" && bellaEnabled ? (
          <div className="lg:hidden max-w-6xl mx-auto px-4 sm:px-6 pb-2">
            <SmartSearch companyPublicId={bellaCompanyId} />
          </div>
        ) : null}
      </header>
      {/* Spacer: matches the fixed header's height. On lg+ the
          header is 3.25rem (one row). On `< lg` widths where the
          search bar is visible we add ~2.5rem for the second row.
          The CSS variable below switches at the same breakpoint via
          a media query in globals.css → tracking the variable
          here would force a client effect; cheaper to use the
          tailwind `lg:` prefix on the spacer itself. */}
      <div
        aria-hidden="true"
        className={
          homeHref !== "/" && bellaEnabled
            ? "h-[calc(var(--app-safe-top,env(safe-area-inset-top,0px))+5.75rem)] lg:h-[calc(var(--app-safe-top,env(safe-area-inset-top,0px))+3.25rem)]"
            : "h-[calc(var(--app-safe-top,env(safe-area-inset-top,0px))+3.25rem)]"
        }
      />
      {/* Desktop left rail. Hidden on `< lg` widths (LeftRailMobile
          handles those via the hamburger). Consumer surfaces only —
          admin / HQ host doesn't get it because the rail's items
          don't apply. */}
      {homeHref !== "/" ? <LeftRail mode="rail" /> : null}
      {/* Flip <html data-theme="dark"> for the duration of any
          authenticated page render. Public marketing routes don't
          mount <AppHeader> so they stay light by default. See
          components/DarkThemeMount.tsx for the full story. */}
      <DarkThemeMount />
      {/* The Bella (bottom-right) and Studio-family (bottom-left)
          floating circles were removed per product direction — they
          cluttered the bottom of every screen. Bella can be
          re-surfaced from the UserMenu dropdown later if wanted, the
          same way "Send feedback" was relocated there. */}
      {needsConsent ? <GdprBanner acceptAction={recordGdprConsent} /> : null}
    </>
  );
}
