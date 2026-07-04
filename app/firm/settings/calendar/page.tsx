import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";

// /firm/settings/calendar, connect Zoom / Google / Microsoft.
//
// OAuth grant routes (`/api/oauth/{provider}/start` +
// `/api/oauth/{provider}/callback`) ship in Phase 6.5. For now the
// page shows the integration state + a runbook link so the
// operator can wire keys and the OAuth client configs externally.

const PROVIDER_META = [
  {
    id: "zoom" as const,
    label: "Zoom",
    body: "Auto-mint Zoom meetings from the engagement page. Requires a Zoom OAuth App with the meeting:write scope.",
    scope: "meeting:write",
  },
  {
    id: "google" as const,
    label: "Google Meet",
    body: "Create Google Meet links + post to your primary Calendar. Requires a Google OAuth 2.0 client with calendar.events scope.",
    scope: "https://www.googleapis.com/auth/calendar.events",
  },
  {
    id: "microsoft" as const,
    label: "Microsoft Teams",
    body: "Mint Teams meetings + post Outlook calendar invites. Requires an Entra app with OnlineMeetings.ReadWrite + Calendars.ReadWrite.",
    scope: "OnlineMeetings.ReadWrite Calendars.ReadWrite",
  },
];

export default async function CalendarSettingsPage() {
  const { admin, user } = await requireUserWithAdmin();
  await requireFirmContext();

  type IntegrationRow = {
    provider: string;
    provider_account_email: string | null;
    scopes: string[] | null;
    created_at: string;
    expires_at: string | null;
  };
  const { data: integrations } = await admin
    .from("firm_calendar_integrations")
    .select("provider, provider_account_email, scopes, created_at, expires_at")
    .eq("user_id", user.id);
  const byProvider = new Map<string, IntegrationRow>();
  for (const row of (integrations ?? []) as IntegrationRow[]) {
    byProvider.set(row.provider, row);
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Calendar settings
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Connect your calendar.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          Connect a calendar provider and the meeting form on each
          engagement will auto-generate a join URL for you. Without
          a connection, meetings are recorded manually (paste a URL,
          or leave blank for in-person).
        </p>

        <ul className="mt-6 grid gap-4">
          {PROVIDER_META.map((p) => {
            const integration = byProvider.get(p.id);
            const connected = Boolean(integration);
            return (
              <li key={p.id} className="card p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="display text-lg text-forest-900">
                        {p.label}
                      </span>
                      <span
                        className={
                          "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                          (connected
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-cream-100 text-ink-muted border-forest-100")
                        }
                      >
                        {connected ? "Connected" : "Not connected"}
                      </span>
                    </div>
                    {connected && integration?.provider_account_email ? (
                      <div className="text-xs text-ink-muted mt-0.5">
                        Connected as{" "}
                        <span className="font-medium text-forest-800">
                          {integration.provider_account_email}
                        </span>
                      </div>
                    ) : null}
                    <p className="mt-2 text-xs text-ink-soft leading-relaxed">
                      {p.body}
                    </p>
                    <div className="mt-2 text-[10px] text-ink-muted">
                      Scope: <code className="font-mono">{p.scope}</code>
                    </div>
                  </div>
                  <Link
                    href={`/api/oauth/${p.id}/start`}
                    className={
                      connected ? "btn-ghost text-sm" : "btn-primary text-sm"
                    }
                  >
                    {connected ? "Reconnect" : "Connect"}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-8 text-[11px] text-ink-muted leading-relaxed">
          OAuth grant routes wire up in Phase 6.5, until then the
          Connect buttons go to a stub that explains the env-var
          requirements. Meeting records still work; provider auto-mint
          falls back to manual entry.
        </p>
      </section>
    </main>
  );
}
