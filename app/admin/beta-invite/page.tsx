import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { BetaInviteForm } from "./BetaInviteForm";

export const dynamic = "force-dynamic";

/**
 * Super-admin tool to send a beta / TestFlight invitation email without
 * editing code. Renders the shared beta-invite template through the Resend
 * transport (see lib/email/send-beta-invite.ts). The TestFlight link itself
 * still comes from App Store Connect; paste it in here.
 */
export default async function BetaInvitePage() {
  const { user } = await requireSuperAdmin();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Link
          href="/admin"
          className="text-sm text-ink-soft hover:text-forest-800"
        >
          &larr; Back to admin
        </Link>
        <div className="mt-4 text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          Super-admin
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Send a beta invite
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-xl leading-relaxed">
          Emails a tester the branded invite with install steps. Paste the
          TestFlight public link (or Play opt-in URL) from the store console.
          Adding the tester in App Store Connect is still a separate step;
          this only sends the email.
        </p>

        <BetaInviteForm />
      </section>
    </main>
  );
}
