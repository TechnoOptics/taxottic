import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CompanyNav } from "@/components/CompanyNav";
import { loadCompanyByPublicId } from "@/lib/tax/company-context";

type Params = Promise<{ publicId: string }>;

/**
 * Setup hub. Combines the four "configure once, rarely revisit"
 * sections (business profile, team members, connected banks, CSV
 * import history) so the user doesn't have to hunt across four
 * separate top tabs. Stats are light - we just want the user to
 * see the current state of each at a glance and one-tap into the
 * full editor.
 */
export default async function SetupHub({ params }: { params: Params }) {
  const { publicId } = await params;
  const { supabase, user, company } = await loadCompanyByPublicId(publicId);
  const taxYear = new Date().getUTCFullYear();

  const [profileResp, teamResp, banksResp, importsResp] = await Promise.all([
    supabase
      .from("business_profiles")
      .select("entity_type, has_home_office")
      .eq("company_id", company.id)
      .eq("tax_year", taxYear)
      .maybeSingle(),
    supabase
      .from("company_members")
      .select("user_id")
      .eq("company_id", company.id),
    supabase
      .from("bank_connections")
      .select("id, status")
      .eq("company_id", company.id),
    supabase
      .from("bank_imports")
      .select("id, status, created_at")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const profileComplete = Boolean(
    company.entity_type && company.state_code && company.name,
  );
  const teamSize = (teamResp.data ?? []).length;
  const banksActive = (banksResp.data ?? []).filter(
    (r) => r.status === "active" || r.status === "connected",
  ).length;
  const totalBanks = (banksResp.data ?? []).length;
  const recentImports = (importsResp.data ?? []).length;
  const pendingImports = (importsResp.data ?? []).filter(
    (r) => r.status !== "applied" && r.status !== "closed",
  ).length;

  const sections: SectionCardProps[] = [
    {
      title: "Business profile",
      subtitle: "Name, entity type, state. Drives the whole forecast.",
      stat: profileComplete
        ? `${company.name} · ${company.entity_type ?? "—"} · ${
            company.state_code ?? "—"
          }`
        : "Profile is incomplete. Set entity type + state to unlock the forecast.",
      primary: { label: "Edit profile", href: `/c/${publicId}/profile` },
      secondaryHref: `/c/${publicId}/profile`,
      attention: !profileComplete,
    },
    {
      title: "Team members",
      subtitle: "People who can edit this company's tax data with you.",
      stat:
        teamSize <= 1
          ? "Just you on this company."
          : `${teamSize} members total.`,
      primary: {
        label: teamSize <= 1 ? "Invite someone" : "Manage team",
        href: `/c/${publicId}/manage`,
      },
      secondaryHref: `/c/${publicId}/manage`,
    },
    {
      title: "Connected banks",
      subtitle: "Pull transactions automatically instead of typing them.",
      stat:
        totalBanks === 0
          ? "No bank connected yet."
          : `${banksActive} of ${totalBanks} ${
              totalBanks === 1 ? "connection" : "connections"
            } active.`,
      primary: {
        label: totalBanks === 0 ? "Connect a bank" : "Manage banks",
        href: `/c/${publicId}/banks`,
      },
      secondaryHref: `/c/${publicId}/banks`,
    },
    {
      title: "CSV imports",
      subtitle: "Bulk-categorize transactions exported from any bank.",
      stat:
        recentImports === 0
          ? "No imports yet."
          : pendingImports > 0
            ? `${pendingImports} of your last ${recentImports} imports still need review.`
            : `${recentImports} recent ${
                recentImports === 1 ? "import" : "imports"
              } - all reviewed.`,
      primary: { label: "Upload CSV", href: `/c/${publicId}/import` },
      secondaryHref: `/c/${publicId}/import`,
      attention: pendingImports > 0,
    },
  ];

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} bellaCompanyId={publicId} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          {company.public_id} <span className="text-gold-700">·</span>{" "}
          Tax year {taxYear}
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">Settings</h1>
        <p className="mt-2 text-sm text-ink-soft max-w-xl">
          One-time configuration for this company. Set this up first
          and the rest of Taxottic just works.
        </p>
        <div aria-hidden="true" className="gold-flourish mt-3">
          <span />
        </div>

        <div className="mt-6">
          <CompanyNav publicId={publicId} active="setup" />
        </div>

        <div className="mt-6 space-y-4">
          {sections.map((s) => (
            <SectionCard key={s.title} {...s} />
          ))}
        </div>
      </section>
    </main>
  );
}

type SectionCardProps = {
  title: string;
  subtitle: string;
  stat: string;
  primary: { label: string; href: string };
  secondaryHref: string;
  /** When true, the card gets a soft amber accent and a quiet
   *  attention dot so the user notices something needs them. */
  attention?: boolean;
};

function SectionCard(s: SectionCardProps) {
  return (
    <div
      className={`card p-5 ${
        s.attention ? "ring-1 ring-gold-400/70 bg-gold-50/30" : ""
      }`}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-baseline gap-2">
          {s.attention ? (
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-gold-600 mt-2"
            />
          ) : null}
          <div>
            <h3 className="display text-lg text-forest-900">{s.title}</h3>
            <p className="text-[12.5px] text-ink-soft mt-0.5">{s.subtitle}</p>
          </div>
        </div>
        <Link
          href={s.secondaryHref}
          className="text-[12.5px] text-gold-700 hover:text-gold-800 font-medium whitespace-nowrap"
        >
          Open →
        </Link>
      </div>
      <p className="mt-3 text-[14px] text-forest-900">{s.stat}</p>
      <div className="mt-4">
        <Link
          href={s.primary.href}
          className="inline-flex items-center justify-center px-4 h-10 rounded-md bg-forest-900 text-cream text-sm font-medium hover:bg-forest-800 transition-colors"
        >
          {s.primary.label}
        </Link>
      </div>
    </div>
  );
}
