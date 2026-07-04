import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";

// /firm/settings, hub page. Settings sub-pages were each shipping
// independently (Phase 4 notifications, Phase 6 calendar, Phase 7
// payments); this index page surfaces them all so a firm operator
// has one place to manage everything firm-wide.
//
// We surface a small status indicator per area so the operator
// sees at-a-glance what's wired up vs not (Stripe connected? Team
// has more than one member? Notifications configured?).

export const dynamic = "force-dynamic";

type AreaCard = {
  label: string;
  href: string;
  body: string;
  status?: { tone: "good" | "warn" | "muted"; text: string };
};

export default async function FirmSettingsHubPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();

  // Pull a quick status snapshot.
  const [
    { count: memberCount },
    { data: stripe },
    { data: prefs },
    { data: calendarRows },
  ] = await Promise.all([
    admin
      .from("firm_members")
      .select("user_id", { count: "exact", head: true })
      .eq("firm_id", ctx.firm.id),
    admin
      .from("firm_stripe_accounts")
      .select("charges_enabled")
      .eq("firm_id", ctx.firm.id)
      .maybeSingle(),
    admin
      .from("firm_notification_preferences")
      .select("digest_cadence")
      .eq("firm_id", ctx.firm.id)
      .eq("user_id", user.id)
      .maybeSingle(),
    admin
      .from("firm_calendar_integrations")
      .select("provider")
      .eq("firm_id", ctx.firm.id)
      .eq("user_id", user.id),
  ]);

  const cards: AreaCard[] = [
    {
      label: "Branding",
      href: "/firm/settings/branding",
      body: "Logo, accent color, address, phone, website. Used on every invitation email + engagement letter.",
      status: ctx.firm.logo_url
        ? { tone: "good", text: "Logo uploaded" }
        : { tone: "warn", text: "Add a logo" },
    },
    {
      label: "Team",
      href: "/firm/settings/team",
      body: "Invite preparers, reviewers, and managers. Assign each one to client engagements.",
      status:
        (memberCount ?? 0) > 1
          ? { tone: "good", text: `${memberCount} members` }
          : { tone: "warn", text: "Just you so far" },
    },
    {
      label: "Notifications",
      href: "/firm/settings/notifications",
      body: "Daily / weekly digest cadence. Pick which event kinds land in your inbox.",
      status: prefs
        ? { tone: "good", text: `${prefs.digest_cadence} digest` }
        : { tone: "muted", text: "Using defaults" },
    },
    {
      label: "Calendar",
      href: "/firm/settings/calendar",
      body: "Connect Zoom, Google Meet, or Microsoft Teams to auto-mint meeting links.",
      status:
        (calendarRows ?? []).length > 0
          ? {
              tone: "good",
              text: `${(calendarRows ?? []).length} connected`,
            }
          : { tone: "warn", text: "Not connected" },
    },
    {
      label: "Payments",
      href: "/firm/settings/payments",
      body: "Stripe Connect for invoicing clients. 3% platform fee.",
      status: stripe?.charges_enabled
        ? { tone: "good", text: "Live" }
        : stripe
          ? { tone: "warn", text: "Onboarding" }
          : { tone: "muted", text: "Not connected" },
    },
    {
      label: "Custom domain",
      href: "/firm/settings/domain",
      body:
        ctx.firm.tier === "enterprise"
          ? "Point your own domain at this firm portal. Enterprise tier."
          : "Available on the Enterprise tier.",
      status:
        ctx.firm.tier === "enterprise"
          ? { tone: "muted", text: "Configure" }
          : { tone: "muted", text: "Enterprise only" },
    },
  ];

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Settings
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Configure {ctx.firm.name}.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          Firm-wide settings. Notifications + calendar live on each
          team member individually (so a preparer can keep their own
          digest cadence); branding, team, and payments are
          firm-level.
        </p>

        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <li key={c.label}>
              <Link
                href={c.href}
                className="card card-hover p-5 flex flex-col gap-2 h-full hover:border-gold-300 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="display text-lg text-forest-900">
                    {c.label}
                  </span>
                  {c.status ? (
                    <span
                      className={
                        "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                        (c.status.tone === "good"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : c.status.tone === "warn"
                            ? "bg-amber-50 text-amber-800 border-amber-200"
                            : "bg-cream-100 text-ink-muted border-forest-100")
                      }
                    >
                      {c.status.text}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-ink-soft leading-relaxed">
                  {c.body}
                </p>
                <span className="mt-auto text-xs text-forest-700">
                  Open →
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-8 text-[11px] text-ink-muted leading-relaxed">
          Subdomain:{" "}
          <code className="font-mono text-forest-800">
            {ctx.firm.slug ?? "-"}.taxottic.com
          </code>
          {" · "}
          Tier:{" "}
          <span className="font-medium text-forest-800">{ctx.firm.tier}</span>
        </div>
      </section>
    </main>
  );
}
