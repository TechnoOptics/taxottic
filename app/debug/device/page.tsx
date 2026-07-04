import { AppHeader } from "@/components/AppHeader";
import { DeviceDiagnostics } from "@/components/debug/DeviceDiagnostics";
import { requireUser } from "@/lib/auth";

export const metadata = {
  title: "Device diagnostics",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /debug/device, on-device probe for the native shells. Renders the
 * REAL AppHeader (so its safe-area padding and the hamburger FAB can be
 * measured as ground truth) plus the diagnostics collector. Reached
 * from Settings → Device diagnostics; auth-gated like every app page
 * and noindexed.
 */
export default async function DeviceDebugPage() {
  const { user } = await requireUser();
  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          Debug
        </div>
        <h1 className="display mt-2 text-3xl text-forest-900">
          Device diagnostics
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          Live safe-area, build, and layout readings from this device.
          Tap <strong>Copy all readings</strong> and paste them to support
          so display issues can be fixed from real numbers.
        </p>
        <div className="mt-6">
          <DeviceDiagnostics />
        </div>
      </section>
    </main>
  );
}
