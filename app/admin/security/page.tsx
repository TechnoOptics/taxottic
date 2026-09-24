import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { createSandboxExcludingClient } from "@/lib/hq/elevated-client";
import { runSecurityPulse, type Monitor, type PulseResult } from "@/lib/security/pulse";
import { runPulseNowAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<PulseResult["status"], string> = {
  healthy: "Healthy",
  attention: "Attention",
  critical: "Critical",
};

const STATUS_TONE: Record<PulseResult["status"], string> = {
  healthy: "text-emerald-700 bg-emerald-50 border-emerald-200",
  attention: "text-amber-700 bg-amber-50 border-amber-200",
  critical: "text-rose-700 bg-rose-50 border-rose-200",
};

const MONITOR_BADGE: Record<Monitor["status"], string> = {
  pass: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  fail: "bg-rose-100 text-rose-800",
};

const MONITOR_DOT: Record<Monitor["status"], string> = {
  pass: "bg-emerald-500",
  warn: "bg-amber-500",
  fail: "bg-rose-500",
};

const CATEGORY_LABEL: Record<Monitor["category"], string> = {
  authentication: "Authentication",
  data: "Data protection",
  network: "Network",
  code: "Code quality",
  compliance: "Compliance",
};

export default async function SecurityDashboardPage() {
  const { user } = await requireSuperAdmin();
  const admin = createSandboxExcludingClient();

  // Pull the most recent run; if there isn't one yet, compute live so the
  // first visit has something to look at.
  const { data: latestRow } = await admin
    .from("security_pulse_runs")
    .select("id, run_at, score, status, results, source")
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let latest: PulseResult;
  let latestRunAt: string;
  let latestSource: string;

  if (latestRow) {
    latest = latestRow.results as PulseResult;
    latestRunAt = latestRow.run_at as string;
    latestSource = (latestRow.source as string) ?? "manual";
  } else {
    latest = await runSecurityPulse();
    latestRunAt = latest.generatedAt;
    latestSource = "live";
  }

  const { data: history } = await admin
    .from("security_pulse_runs")
    .select("id, run_at, score, status, source")
    .order("run_at", { ascending: false })
    .limit(10);

  const groupedMonitors = groupByCategory(latest.monitors);

  return (
    <main className="min-h-screen bg-cream">
      <AppHeader email={user.email ?? undefined} homeHref="/" />
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Security
            </div>
            <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
              Pulse and monitors
            </h1>
            <p className="mt-2 text-sm text-ink-soft max-w-2xl">
              Live read on every security control we run. The score is the
              weighted average of every monitor; one failing monitor cannot
              drag the whole thing below 0.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/" className="btn-ghost">
              Back to admin
            </Link>
            <form action={runPulseNowAction}>
              <button type="submit" className="btn-primary">
                Run pulse now
              </button>
            </form>
          </div>
        </div>

        <section className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div
            className={`card p-6 border ${STATUS_TONE[latest.status]} lg:col-span-2`}
          >
            <div className="text-xs uppercase tracking-[0.18em] opacity-75">
              Current pulse
            </div>
            <div className="mt-2 flex items-end gap-3">
              <div className="text-6xl font-bold tabular-nums">
                {latest.score}
              </div>
              <div className="pb-2 text-sm font-medium">/ 100</div>
              <div className="pb-2 text-sm font-semibold ml-2">
                {STATUS_LABEL[latest.status]}
              </div>
            </div>
            <div className="mt-3 text-xs opacity-80">
              {summary(latest.monitors)} · last run{" "}
              {timeAgo(latestRunAt)} ({latestSource})
            </div>
          </div>

          <div className="card p-6">
            <div className="text-xs uppercase tracking-[0.18em] text-gold-700">
              Recent runs
            </div>
            {history && history.length > 0 ? (
              <ul className="mt-3 grid gap-1.5 text-sm">
                {history.map((h) => (
                  <li
                    key={h.id as string}
                    className="flex items-center justify-between"
                  >
                    <span className="tabular-nums text-ink-soft">
                      {timeAgo(h.run_at as string)}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${MONITOR_BADGE[severityToMonitor(h.status as PulseResult["status"])]}`}
                    >
                      {h.score}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">
                No prior runs yet. Hit &quot;Run pulse now&quot; to seed the timeline.
              </p>
            )}
          </div>
        </section>

        <section className="mt-8 grid gap-6">
          {Array.from(groupedMonitors.entries()).map(([category, monitors]) => (
            <div key={category}>
              <h2 className="display text-xl text-forest-900">
                {CATEGORY_LABEL[category]}
              </h2>
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                {monitors.map((m) => (
                  <div key={m.id} className="card p-4">
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full ${MONITOR_DOT[m.status]}`}
                        aria-hidden="true"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-forest-900">
                            {m.name}
                          </h3>
                          <span
                            className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${MONITOR_BADGE[m.status]}`}
                          >
                            {m.status}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                          {m.detail}
                        </p>
                        {m.remediation ? (
                          <p className="mt-2 text-xs text-amber-800 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                            <strong className="font-semibold">Fix:</strong>{" "}
                            {m.remediation}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="mt-10 card p-6 bg-white">
          <h2 className="display text-lg text-forest-900">How this works</h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-3xl">
            Each monitor runs a small, read-only check against the codebase or
            a live production endpoint. Filesystem checks are instant; the two
            network probes (TLS handshake, security headers) cap at 5 seconds
            each. The aggregate score weights{" "}
            <code className="text-xs">pass=100%</code>,{" "}
            <code className="text-xs">warn=70%</code>,{" "}
            <code className="text-xs">fail=0%</code>. For deeper findings (npm
            audit, Supabase advisor, full OWASP scan), run the monthly audit
            pipeline at <code className="text-xs">npm run audits:monthly</code>{" "}
            or check the OneDrive Compliance archive.
          </p>
        </section>
      </section>
    </main>
  );
}

function groupByCategory(monitors: Monitor[]): Map<Monitor["category"], Monitor[]> {
  const order: Monitor["category"][] = [
    "authentication",
    "data",
    "network",
    "code",
    "compliance",
  ];
  const map = new Map<Monitor["category"], Monitor[]>();
  for (const cat of order) map.set(cat, []);
  for (const m of monitors) map.get(m.category)?.push(m);
  for (const [k, v] of map) if (v.length === 0) map.delete(k);
  return map;
}

function summary(monitors: Monitor[]): string {
  const pass = monitors.filter((m) => m.status === "pass").length;
  const warn = monitors.filter((m) => m.status === "warn").length;
  const fail = monitors.filter((m) => m.status === "fail").length;
  return `${pass} pass, ${warn} warn, ${fail} fail`;
}

function severityToMonitor(s: PulseResult["status"]): Monitor["status"] {
  return s === "healthy" ? "pass" : s === "attention" ? "warn" : "fail";
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
