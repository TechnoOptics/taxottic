import { Wordmark } from "./Wordmark";
import { BellaFAB } from "./BellaFAB";
import { UserMenu } from "./UserMenu";
import { GdprBanner } from "./GdprBanner";
import { FeedbackButton } from "./FeedbackButton";
import { NoCapture } from "./NoCapture";
import { Watermark } from "./Watermark";
import { createClient } from "@/lib/supabase/server";
import { recordGdprConsent } from "@/app/actions/consent";
import { submitFeedback } from "@/app/actions/feedback";

type AppHeaderProps = {
  email?: string;
  bellaCompanyId?: string;
  /** Pass true on routes that are intentionally printable, e.g., the
   *  year-end CPA export. When omitted, Ctrl+P is blocked and the print
   *  stylesheet renders a Terms-of-Use notice instead of the page. */
  allowPrint?: boolean;
};

export async function AppHeader({
  email,
  bellaCompanyId,
  allowPrint = false,
}: AppHeaderProps) {
  // Pull profile for avatar + display name + GDPR state.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let fullName: string | null = null;
  let avatarUrl: string | null = null;
  let needsConsent = false;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, avatar_url, gdpr_consented_at")
      .eq("id", user.id)
      .maybeSingle();
    fullName = profile?.full_name ?? null;
    avatarUrl = profile?.avatar_url ?? null;
    needsConsent = !profile?.gdpr_consented_at;
  }

  return (
    <>
      <header
        className="app-header fixed top-0 left-0 right-0 z-20"
        style={{
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div
          className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3 relative"
          style={{
            paddingTop: "calc(0.875rem + env(safe-area-inset-top, 0px))",
            paddingBottom: "0.875rem",
          }}
        >
          <Wordmark href="/dashboard" size="sm" tone="cream" />
          <UserMenu
            email={email ?? null}
            fullName={fullName}
            avatarUrl={avatarUrl}
          />
        </div>
      </header>
      {/* Spacer to offset the fixed header so page content isn't hidden under it. */}
      <div
        aria-hidden="true"
        style={{
          height:
            "calc(0.875rem + env(safe-area-inset-top, 0px) + 0.875rem + 2.25rem)",
        }}
      />
      <BellaFAB companyId={bellaCompanyId} />
      <FeedbackButton submitAction={submitFeedback} />
      {needsConsent ? <GdprBanner acceptAction={recordGdprConsent} /> : null}
      {/* Capture-deterrent stack. Applies on every authenticated page;
          unauthenticated visitors don't render AppHeader so this is
          scoped to logged-in users by construction. */}
      {user ? (
        <>
          <NoCapture allowPrint={allowPrint} />
          <Watermark email={user.email} />
        </>
      ) : null}
    </>
  );
}
