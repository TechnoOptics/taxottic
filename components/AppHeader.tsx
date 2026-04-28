import { Wordmark } from "./Wordmark";
import { BellaFAB } from "./BellaFAB";
import { UserMenu } from "./UserMenu";
import { createClient } from "@/lib/supabase/server";

type AppHeaderProps = {
  email?: string;
  bellaCompanyId?: string;
};

export async function AppHeader({ email, bellaCompanyId }: AppHeaderProps) {
  // Pull profile for avatar + display name. Cheap; we already auth above.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let fullName: string | null = null;
  let avatarUrl: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    fullName = profile?.full_name ?? null;
    avatarUrl = profile?.avatar_url ?? null;
  }

  return (
    <>
      <header
        className="header-glow-line fixed top-0 left-0 right-0 z-20 border-b border-forest-100/60"
        style={{
          backgroundColor: "rgba(251, 247, 233, 0.85)",
          backdropFilter: "saturate(140%) blur(10px)",
          WebkitBackdropFilter: "saturate(140%) blur(10px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div
          className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3"
          style={{
            paddingTop: "calc(0.875rem + env(safe-area-inset-top, 0px))",
            paddingBottom: "0.875rem",
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <UserMenu
              email={email ?? null}
              fullName={fullName}
              avatarUrl={avatarUrl}
            />
            <Wordmark href="/dashboard" size="sm" />
          </div>
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
    </>
  );
}
