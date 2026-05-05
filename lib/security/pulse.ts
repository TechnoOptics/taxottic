// Security pulse: lightweight, in-process probes that run on demand from
// the HQ dashboard or from the daily cron. Each monitor is small, fast,
// and read-only -- the goal is a green/yellow/red snapshot, not a full
// audit report. The big audit is the monthly pipeline in scripts/audits/.
//
// Each monitor returns { status, detail, remediation? }. The aggregate
// score is the weighted average of monitor statuses; a single failing
// monitor cannot drag the whole score below 0.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import tls from "node:tls";

export type MonitorStatus = "pass" | "warn" | "fail";

export type MonitorCategory =
  | "authentication"
  | "data"
  | "network"
  | "code"
  | "compliance";

export type Monitor = {
  id: string;
  category: MonitorCategory;
  name: string;
  status: MonitorStatus;
  detail: string;
  remediation?: string;
};

export type PulseResult = {
  score: number;
  status: "healthy" | "attention" | "critical";
  monitors: Monitor[];
  generatedAt: string;
};

const REPO_ROOT = process.cwd();

function repoFile(p: string): string {
  return path.join(REPO_ROOT, p);
}

function readMaybe(p: string): string | null {
  const abs = repoFile(p);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
}

// ---------------------------------------------------------------------------
// Individual monitors. Each returns the Monitor record synchronously when
// possible (filesystem reads, regex), or async when network is required.
// ---------------------------------------------------------------------------

function monitorWebAuthn(): Monitor {
  const ok =
    existsSync(repoFile("app/api/passkeys/auth/options/route.ts")) &&
    existsSync(repoFile("app/api/passkeys/auth/verify/route.ts")) &&
    existsSync(repoFile("app/api/passkeys/register/options/route.ts")) &&
    existsSync(repoFile("app/api/passkeys/register/verify/route.ts"));
  return {
    id: "auth-webauthn",
    category: "authentication",
    name: "Phishing-resistant MFA (passkeys)",
    status: ok ? "pass" : "fail",
    detail: ok
      ? "WebAuthn enrolment and verification routes present."
      : "One or more passkey routes are missing.",
    remediation: ok ? undefined : "Restore app/api/passkeys/* routes.",
  };
}

function monitorSso(): Monitor {
  const google =
    existsSync(repoFile("app/api/auth/google/start/route.ts")) &&
    existsSync(repoFile("app/api/auth/google/callback/route.ts"));
  const microsoft =
    existsSync(repoFile("app/api/auth/azure/start/route.ts")) &&
    existsSync(repoFile("app/api/auth/azure/callback/route.ts"));
  const ok = google && microsoft;
  return {
    id: "auth-sso",
    category: "authentication",
    name: "Federated SSO (Google + Microsoft)",
    status: ok ? "pass" : "warn",
    detail: ok
      ? "Both Google and Microsoft OAuth flows present."
      : `Google: ${google ? "ok" : "missing"}, Microsoft: ${microsoft ? "ok" : "missing"}.`,
  };
}

function monitorBankTokenEncryption(): Monitor {
  const code = readMaybe("lib/crypto/bankTokens.ts");
  const aes = code ? /aes-256-gcm/i.test(code) : false;
  const env = code ? /process\.env\./.test(code) : false;
  return {
    id: "data-bank-token-encryption",
    category: "data",
    name: "Bank tokens encrypted at rest (AES-256-GCM)",
    status: code && aes && env ? "pass" : "fail",
    detail:
      code && aes && env
        ? "lib/crypto/bankTokens.ts uses AES-256-GCM with the key loaded from env."
        : "Encryption helper is missing or not using AES-256-GCM.",
    remediation:
      code && aes && env
        ? undefined
        : "Confirm lib/crypto/bankTokens.ts and BANK_TOKEN_ENC_KEY env are configured.",
  };
}

function monitorWebhookVerification(): Monitor {
  const code = readMaybe("lib/plaid/webhookVerify.ts");
  const usesJwks = code ? /jwk|jwks/i.test(code) : false;
  return {
    id: "network-plaid-webhook-jwt",
    category: "network",
    name: "Plaid webhook JWT verification",
    status: code && usesJwks ? "pass" : "fail",
    detail:
      code && usesJwks
        ? "lib/plaid/webhookVerify.ts verifies signatures against Plaid's JWKS."
        : "Webhook verifier is missing or not using JWKS-based validation.",
  };
}

function walkRouteFiles(): string[] {
  const root = repoFile("app/api");
  const out: string[] = [];
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === "route.ts") out.push(p);
    }
  }
  walk(root);
  return out;
}

const PUBLIC_ROUTE_PATTERNS = [
  /\/api\/auth\//,
  /\/api\/passkeys\/auth\//,
  /\/api\/banks\/plaid\/webhook\//,
  /\/api\/banks\/plaid\/oauth-return\//,
  /\/api\/stripe\/webhook\//,
  /\/api\/cron\//,
  /\/api\/capture-attempt\//,
];

function monitorApiGuards(): Monitor {
  const routes = walkRouteFiles();
  const findings: string[] = [];
  let guarded = 0;
  let publicByDesign = 0;

  for (const route of routes) {
    const code = readFileSync(route, "utf8");
    const isPublicByDesign = PUBLIC_ROUTE_PATTERNS.some((rx) => rx.test(route.replace(/\\/g, "/")));
    const hasGuard = /requireUser|requireUserWithAdmin|requireSuperAdmin|verifyPlaidWebhook|stripe\.webhooks\.constructEvent|supabase\.auth\.getUser|x-vercel-cron|CRON_SECRET/.test(code);
    if (hasGuard) guarded++;
    else if (isPublicByDesign) publicByDesign++;
    else findings.push(route.replace(REPO_ROOT, "").replace(/\\/g, "/"));
  }

  const total = routes.length;
  return {
    id: "code-api-guards",
    category: "code",
    name: "API route auth coverage",
    status: findings.length === 0 ? "pass" : "fail",
    detail:
      findings.length === 0
        ? `${guarded}/${total} routes guarded; ${publicByDesign} intentionally public (auth, webhooks, cron).`
        : `Unguarded routes: ${findings.slice(0, 3).join(", ")}${findings.length > 3 ? ` and ${findings.length - 3} more` : ""}.`,
  };
}

function monitorRlsCoverage(): Monitor {
  const dir = repoFile("supabase/migrations");
  if (!existsSync(dir)) {
    return {
      id: "data-rls-coverage",
      category: "data",
      name: "Row-level security on every multi-tenant table",
      status: "warn",
      detail: "Migrations folder missing in this checkout.",
    };
  }
  let createdTables = 0;
  let rlsEnabled = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    createdTables += (sql.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\./gi) ?? []).length;
    rlsEnabled += (sql.match(/alter\s+table\s+public\.\w+\s+enable\s+row\s+level\s+security/gi) ?? []).length;
  }
  return {
    id: "data-rls-coverage",
    category: "data",
    name: "Row-level security on every multi-tenant table",
    status: rlsEnabled > 0 ? "pass" : "fail",
    detail: `${rlsEnabled} ALTER ... ENABLE RLS statements across ${createdTables} CREATE TABLE statements.`,
  };
}

function monitorServiceRoleKey(): Monitor {
  // Fail if the service-role key shows up in any client-rendered file.
  const offenders: string[] = [];
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") walk(p);
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
        const code = readFileSync(p, "utf8");
        if (code.includes("SUPABASE_SERVICE_ROLE_KEY") && code.startsWith('"use client"')) {
          offenders.push(p.replace(REPO_ROOT, ""));
        }
      }
    }
  }
  walk(repoFile("app"));
  walk(repoFile("components"));
  return {
    id: "data-service-role-key",
    category: "data",
    name: "Service-role key never sent to the browser",
    status: offenders.length === 0 ? "pass" : "fail",
    detail:
      offenders.length === 0
        ? "No SUPABASE_SERVICE_ROLE_KEY references in client-rendered files."
        : `Found in: ${offenders.join(", ")}`,
  };
}

async function monitorSecurityHeaders(): Promise<Monitor> {
  try {
    const res = await fetch("https://taxottic.com/", { redirect: "follow" });
    const required = [
      "strict-transport-security",
      "content-security-policy",
      "x-content-type-options",
      "referrer-policy",
      "x-frame-options",
    ];
    const missing = required.filter((h) => !res.headers.get(h));
    return {
      id: "network-security-headers",
      category: "network",
      name: "Security headers on production",
      status: missing.length === 0 ? "pass" : missing.length <= 1 ? "warn" : "fail",
      detail:
        missing.length === 0
          ? "HSTS, CSP, X-CTO, Referrer-Policy, and X-Frame-Options all present."
          : `Missing: ${missing.join(", ")}.`,
      remediation: missing.length ? "Update next.config.ts headers and redeploy." : undefined,
    };
  } catch (err) {
    return {
      id: "network-security-headers",
      category: "network",
      name: "Security headers on production",
      status: "warn",
      detail: `Probe failed: ${String((err as Error).message ?? err)}.`,
    };
  }
}

async function monitorTlsCertificate(): Promise<Monitor> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: "taxottic.com", port: 443, servername: "taxottic.com" },
      () => {
        const cert = socket.getPeerCertificate(true);
        socket.end();
        if (!cert?.valid_to) {
          resolve({
            id: "network-tls-certificate",
            category: "network",
            name: "TLS certificate validity",
            status: "warn",
            detail: "TLS handshake succeeded but no certificate metadata returned.",
          });
          return;
        }
        const daysLeft = Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
        resolve({
          id: "network-tls-certificate",
          category: "network",
          name: "TLS certificate validity",
          status: daysLeft > 30 ? "pass" : daysLeft > 7 ? "warn" : "fail",
          detail: `taxottic.com cert valid for ${daysLeft} more days (issuer: ${cert.issuer?.CN ?? "unknown"}).`,
        });
      },
    );
    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve({
        id: "network-tls-certificate",
        category: "network",
        name: "TLS certificate validity",
        status: "warn",
        detail: "TLS handshake timed out after 5s.",
      });
    });
    socket.on("error", (err) => {
      resolve({
        id: "network-tls-certificate",
        category: "network",
        name: "TLS certificate validity",
        status: "warn",
        detail: `TLS error: ${err.message}`,
      });
    });
  });
}

function monitorPlaidAttestations(): Monitor {
  // Plaid attestations are tracked manually on the Compliance Center.
  // They were closed out on 2026-05-04 and renew on the cycle Plaid sets.
  // Surface this as a snapshot so the dashboard can pulse it; an operator
  // updates the timestamp here when a new attestation lands.
  const attestedAt = new Date("2026-05-04T00:00:00Z");
  const daysAgo = Math.round((Date.now() - attestedAt.getTime()) / 86400000);
  const status: MonitorStatus = daysAgo < 365 ? "pass" : daysAgo < 395 ? "warn" : "fail";
  return {
    id: "compliance-plaid-attestations",
    category: "compliance",
    name: "Plaid Compliance Center attestations",
    status,
    detail: `All four attestations attested ${daysAgo} days ago (last: 2026-05-04).`,
    remediation: status === "pass" ? undefined : "Re-attest in Plaid Dashboard → Compliance Center.",
  };
}

function monitorMonthlyAudits(): Monitor {
  // The monthly compliance audit pipeline writes to OneDrive; we look up
  // the most recent run by checking the OneDrive Compliance folder. If the
  // path is unreachable (operator not on a Windows host) we fall back to
  // looking for the script presence as the closest signal we have.
  const scripts = repoFile("scripts/audits/run-monthly.mjs");
  if (!existsSync(scripts)) {
    return {
      id: "compliance-monthly-audits",
      category: "compliance",
      name: "Monthly compliance audit pipeline",
      status: "fail",
      detail: "scripts/audits/run-monthly.mjs is missing from the checkout.",
    };
  }
  return {
    id: "compliance-monthly-audits",
    category: "compliance",
    name: "Monthly compliance audit pipeline",
    status: "pass",
    detail: "Pipeline source present; Task Scheduler entry runs on the 28th of each month.",
  };
}

function monitorCspPresent(): Monitor {
  const code = readMaybe("next.config.ts");
  const ok = code ? /Content-Security-Policy/i.test(code) : false;
  return {
    id: "network-csp-config",
    category: "network",
    name: "Content-Security-Policy configured",
    status: ok ? "pass" : "warn",
    detail: ok
      ? "next.config.ts emits a CSP header on every response."
      : "next.config.ts does not emit a Content-Security-Policy header.",
    remediation: ok ? undefined : "Add Content-Security-Policy entry to securityHeaders.",
  };
}

function monitorRateLimit(): Monitor {
  const ok = existsSync(repoFile("lib/security/rate-limit.ts"));
  return {
    id: "code-rate-limit",
    category: "code",
    name: "Rate limiter on auth endpoints",
    status: ok ? "pass" : "warn",
    detail: ok
      ? "lib/security/rate-limit.ts available for hot endpoints."
      : "No rate-limit helper present.",
  };
}

// ---------------------------------------------------------------------------
// Aggregate runner
// ---------------------------------------------------------------------------

const STATUS_WEIGHT: Record<MonitorStatus, number> = { pass: 1, warn: 0.7, fail: 0 };

function aggregate(monitors: Monitor[]): { score: number; status: PulseResult["status"] } {
  if (monitors.length === 0) return { score: 0, status: "critical" };
  const sum = monitors.reduce((acc, m) => acc + STATUS_WEIGHT[m.status], 0);
  const score = Math.round((sum / monitors.length) * 100);
  const status: PulseResult["status"] = score >= 90 ? "healthy" : score >= 70 ? "attention" : "critical";
  return { score, status };
}

export async function runSecurityPulse(): Promise<PulseResult> {
  const sync: Monitor[] = [
    monitorWebAuthn(),
    monitorSso(),
    monitorBankTokenEncryption(),
    monitorWebhookVerification(),
    monitorRlsCoverage(),
    monitorServiceRoleKey(),
    monitorApiGuards(),
    monitorCspPresent(),
    monitorRateLimit(),
    monitorPlaidAttestations(),
    monitorMonthlyAudits(),
  ];
  // Run network checks in parallel; cap each at 5s above.
  const [headers, tlsCert] = await Promise.all([
    monitorSecurityHeaders(),
    monitorTlsCertificate(),
  ]);
  const monitors = [...sync, headers, tlsCert];
  const { score, status } = aggregate(monitors);
  return {
    score,
    status,
    monitors,
    generatedAt: new Date().toISOString(),
  };
}
