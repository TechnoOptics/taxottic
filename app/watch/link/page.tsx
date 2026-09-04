import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { WatchLinkConfirm } from "@/components/WatchLinkConfirm";

export const dynamic = "force-dynamic";

// /watch/link?code=…, the destination the watch's pairing QR
// encodes. Opened on the signed-in phone (in-app WebView or any
// browser). Session-gated: the watch binds to whoever is signed in
// here, so the QR itself never carries a credential.
export default async function WatchLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const normalized = (code ?? "").trim().toUpperCase();

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        background:
          "var(--navy-band)",
      }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div
            className="text-xl font-semibold tracking-[0.3em]"
            style={{ color: "#d5bb7e" }}
          >
            TAXOTTIC
          </div>
          <div className="mt-1 text-xs text-[#fbf7e9b3]">
            Watch pairing
          </div>
        </div>

        {!user ? (
          <div className="rounded-2xl bg-[#1d2843] border border-[#d5bb7e26] p-6 text-center">
            <h2 className="text-lg font-semibold text-[#fbf7e9]">
              Sign in to link your watch
            </h2>
            <p className="mt-1 text-sm text-[#fbf7e9b3]">
              Open this on the phone signed into your Taxottic account,
              then re-scan the code on your watch.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-block w-full rounded-xl bg-[#d5bb7e] px-4 py-3 font-semibold text-[#121a2a]"
            >
              Sign in
            </Link>
          </div>
        ) : !normalized ? (
          <div className="rounded-2xl bg-[#1d2843] border border-[#d5bb7e26] p-6 text-center">
            <h2 className="text-lg font-semibold text-[#fbf7e9]">
              No pairing code
            </h2>
            <p className="mt-1 text-sm text-[#fbf7e9b3]">
              Scan the QR shown on your watch (Taxottic → the pairing
              screen) with your phone camera to land here with a code.
            </p>
          </div>
        ) : (
          <WatchLinkConfirm code={normalized} />
        )}
      </div>
    </main>
  );
}
