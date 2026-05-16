import { Wordmark } from "./Wordmark";
import { BellaFAB } from "./BellaFAB";
import { StudioFamilyFAB } from "./StudioFamilyFAB";
import { UserMenu } from "./UserMenu";
import { GdprBanner } from "./GdprBanner";
import { HeaderScrollHider } from "./HeaderScrollHider";
import { DarkThemeMount } from "./DarkThemeMount";
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
      <header
        className="app-header app-header-shrinkable sticky top-0 left-0 right-0 z-20"
        style={{
          // Always reserve the status-bar / notch / Dynamic-Island
          // height so the sticky header's green extends behind the
          // status bar (white text on green) and its content never
          // sits under the island — not just after scroll. The
          // globals.css scrolled-state rule no longer adds this (it
          // would double-pad).
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div
          className="app-header-row max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3 relative"
          style={{
            paddingTop: "calc(0.625rem + env(safe-area-inset-top, 0px))",
            paddingBottom: "0.625rem",
          }}
        >
          <Wordmark href={homeHref} size="sm" tone="cream" />
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
      </header>
      {/* Auto-shrinks the header on scroll on mobile (CSS-only, no
          JS animation - we just toggle a body class). */}
      <HeaderScrollHider />
      {/* Flip <html data-theme="dark"> for the duration of any
          authenticated page render. Public marketing routes don't
          mount <AppHeader> so they stay light by default. See
          components/DarkThemeMount.tsx for the full story. */}
      <DarkThemeMount />
      {/* Bella stays as a customer-app FAB. The "Send feedback" FAB
          used to live above it; that stacked-bubbles look read as
          cluttered, so the feedback entry point moved into the
          UserMenu dropdown ("Send feedback" near "Sign out"). Bella
          is hidden on admin pages (hq.taxottic.com) so the super-
          admin view stays focused and we don't spend Anthropic
          tokens from the ops console. */}
      {user && homeHref !== "/" ? (
        <BellaFAB companyId={bellaCompanyId} enabled={bellaEnabled} />
      ) : null}
      {/* Cross-product launcher in the bottom-LEFT (sibling to the
          Bella FAB on the bottom-right). Lists Taxottic + Advottic +
          Techno Optics studio so the family relationship is visible
          on every authenticated page. Visible on admin pages too —
          super-admins are the audience who most often cross between
          sister products. */}
      {user ? <StudioFamilyFAB /> : null}
      {needsConsent ? <GdprBanner acceptAction={recordGdprConsent} /> : null}
    </>
  );
}
