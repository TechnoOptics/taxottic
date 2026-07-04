import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmContext } from "@/lib/firm/context";

// Tier 3 #2: First-time firm onboarding tour.
//
// A simple, paragraph-driven tour that walks the firm owner
// through the four "moves" that unlock the cockpit:
//   1. Brand your firm + invite teammates
//   2. Onboard your first client
//   3. Wire payments
//   4. Connect calendars + signature provider
//
// We don't ship a tooltips-over-the-real-UI library; that's
// brittle and inconsistent across browsers. A linear walkthrough
// surface lives at /firm/onboarding and links into the real
// destinations from each step.

export const metadata = {
  title: "Get started, Firm cockpit",
  description: "Set up your firm cockpit in four short steps.",
  robots: { index: false, follow: false },
};

type Step = {
  number: number;
  title: string;
  body: string;
  href: string;
  cta: string;
  done?: boolean;
};

export default async function FirmOnboardingPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmContext();
  const firm = ctx.firm;

  // Each step has a real "done" predicate so the tour stays
  // useful when the firm comes back later. Cheap one-row lookups.
  const [
    { data: members },
    { count: engagementCount },
    { data: stripe },
    { data: oauth },
  ] = await Promise.all([
    admin
      .from("firm_members")
      .select("user_id")
      .eq("firm_id", firm.id)
      .limit(2),
    admin
      .from("firm_engagements")
      .select("id", { count: "exact", head: true })
      .eq("firm_id", firm.id),
    admin
      .from("firm_stripe_accounts")
      .select("charges_enabled")
      .eq("firm_id", firm.id)
      .maybeSingle(),
    admin
      .from("firm_calendar_integrations")
      .select("provider")
      .eq("firm_id", firm.id)
      .limit(1)
      .maybeSingle(),
  ]);

  const hasTeam = (members ?? []).length >= 2;
  const hasClients = (engagementCount ?? 0) > 0;
  const hasPayments = !!stripe?.charges_enabled;
  const hasOauth = !!oauth?.provider;

  const steps: Step[] = [
    {
      number: 1,
      title: "Brand your firm + invite teammates",
      body: "Drop in your logo, accent color, and a one-line description. Invite preparers so they can start picking up engagements alongside you.",
      href: "/firm/settings",
      cta: hasTeam ? "Manage team" : "Open firm settings",
      done: hasTeam,
    },
    {
      number: 2,
      title: "Onboard your first client",
      body: "Paste a CSV (up to 200 rows) or use the single-client invite form. Each invitation routes existing Taxottic users straight into an engagement; brand-new clients get a branded signup link.",
      href: "/firm/clients/import",
      cta: hasClients ? "Bulk import" : "Onboard a client",
      done: hasClients,
    },
    {
      number: 3,
      title: "Wire payments",
      body: "Connect a Stripe Express account so your invoices can collect payment without you leaving the cockpit. We charge a 3% platform fee; everything else goes to your Stripe payout account.",
      href: "/firm/settings/payments",
      cta: hasPayments ? "Manage payments" : "Connect Stripe",
      done: hasPayments,
    },
    {
      number: 4,
      title: "Connect calendars + signature",
      body: "Link Zoom, Google Calendar, or Microsoft Teams to schedule client meetings end-to-end. Connect Documenso (or DocuSign on enterprise) to dispatch engagement letters with a single click.",
      href: "/firm/settings/integrations",
      cta: hasOauth ? "Manage integrations" : "Connect calendars",
      done: hasOauth,
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Firm cockpit
          </Link>{" "}
          · Get started
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Set up {firm.name}.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          Four short steps. You can do them in any order, and you
          can come back later, we&apos;ll keep track of where you
          are.
        </p>

        <div className="mt-6 rounded-2xl border border-forest-100 bg-cream-100 p-4 flex items-center gap-3">
          <div
            className="size-10 rounded-full bg-gold-100 flex items-center justify-center text-sm font-semibold text-gold-800"
            aria-hidden="true"
          >
            {completed}/4
          </div>
          <div className="text-sm text-ink-soft">
            {completed === 4
              ? "All four steps complete, you're ready to invite clients at scale."
              : `${4 - completed} ${
                  4 - completed === 1 ? "step" : "steps"
                } to go before your cockpit is fully wired.`}
          </div>
        </div>

        <ol className="mt-6 grid gap-3">
          {steps.map((s) => (
            <li
              key={s.number}
              className={
                "card p-5 grid grid-cols-[auto_1fr_auto] gap-4 items-center " +
                (s.done ? "opacity-75" : "")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "size-9 rounded-full flex items-center justify-center text-sm font-semibold " +
                  (s.done
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-cream-200 text-forest-800")
                }
              >
                {s.done ? "✓" : s.number}
              </span>
              <div className="min-w-0">
                <h2 className="display text-base text-forest-900">
                  {s.title}
                </h2>
                <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                  {s.body}
                </p>
              </div>
              <Link
                href={s.href}
                className={
                  s.done ? "btn-ghost text-xs px-3 h-9" : "btn-primary text-xs"
                }
              >
                {s.cta} →
              </Link>
            </li>
          ))}
        </ol>

        <p className="mt-8 text-[11px] text-ink-muted leading-relaxed max-w-xl">
          Stuck? Email{" "}
          <a
            href="mailto:contact@taxottic.com"
            className="underline hover:text-forest-800"
          >
            contact@taxottic.com
          </a>
          {" "}- most setup questions are answered same business
          day.
        </p>
      </section>
    </main>
  );
}
