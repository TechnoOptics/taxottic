import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/Wordmark";

type Params = Promise<{ token: string }>;

export default async function InvitePage({ params }: { params: Params }) {
  const { token } = await params;
  const supabase = await createClient();

  const { data: rows } = await supabase.rpc("lookup_invitation", {
    p_token: token,
  });
  // The RPC now returns the manager-supplied full_name, title, and a
  // personal welcome message in addition to the original fields.
  const invite = rows?.[0] as
    | {
        company_name: string;
        company_public_id: string;
        role: string;
        invitee_email: string;
        invitee_full_name: string | null;
        invitee_title: string | null;
        personal_message: string | null;
        expires_at: string;
        accepted_at: string | null;
      }
    | undefined;

  if (!invite) {
    return (
      <Frame>
        <h1 className="display text-2xl text-forest-900">
          Invitation not found
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          This link is invalid or has expired.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm text-forest-700 hover:text-forest-900"
        >
          Back home
        </Link>
      </Frame>
    );
  }

  if (invite.accepted_at) {
    return (
      <Frame>
        <h1 className="display text-2xl text-forest-900">Already accepted</h1>
        <p className="mt-2 text-sm text-ink-soft">
          This invitation has already been used.
        </p>
      </Frame>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (
    user &&
    user.email?.toLowerCase() === invite.invitee_email.toLowerCase()
  ) {
    const { data: companyPublicId, error } = await supabase.rpc(
      "accept_invitation",
      { p_token: token },
    );
    if (!error && companyPublicId) {
      // Send fresh joiners through the role/title welcome before the company.
      redirect(
        `/onboarding/employee-role?next=/c/${companyPublicId}/forecast`,
      );
    }
  }

  // First name for the greeting, when the manager provided one.
  const firstName = invite.invitee_full_name?.split(/\s+/)[0] ?? null;

  return (
    <Frame>
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        You&apos;re invited
      </div>
      <h1 className="display mt-2 text-3xl text-forest-900">
        {firstName
          ? `Welcome aboard, ${firstName}.`
          : `You are invited to ${invite.company_name}.`}
      </h1>
      {firstName ? (
        <p className="mt-2 text-sm text-ink-soft">
          Joining{" "}
          <span className="font-medium text-forest-800">
            {invite.company_name}
          </span>
          {invite.invitee_title ? (
            <>
              {" as "}
              <span className="font-medium text-forest-800">
                {invite.invitee_title}
              </span>
            </>
          ) : null}
          .
        </p>
      ) : null}

      {invite.personal_message ? (
        <blockquote className="mt-5 rounded-xl border-l-4 border-gold-400 bg-cream/60 px-4 py-3 text-sm text-ink-soft italic leading-relaxed">
          {invite.personal_message}
        </blockquote>
      ) : null}

      <p className="mt-5 text-sm text-ink-soft">
        Sign in with{" "}
        <span className="font-medium text-forest-800">
          {invite.invitee_email}
        </span>{" "}
        to accept. Your access level is{" "}
        <span className="font-medium text-forest-800">{invite.role}</span>.
      </p>

      {user &&
      user.email?.toLowerCase() !== invite.invitee_email.toLowerCase() ? (
        <p className="mt-4 text-sm text-amber-800">
          You are signed in as {user.email}. Sign out and sign back in with the
          invited address.
        </p>
      ) : null}

      <Link
        href={`/login?next=/invite/${token}`}
        className="btn-primary mt-7"
      >
        Sign in to accept
      </Link>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Wordmark size="md" />
        </div>
        <div className="card p-6 sm:p-8">{children}</div>
      </div>
    </main>
  );
}
