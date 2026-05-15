// Vercel domains API helpers.
//
// We talk to /v9/projects/{project}/domains (read + write) plus
// /v6/domains/{domain}/config (verification + cert status). All
// requests require VERCEL_API_TOKEN (Personal Account or Team
// token with appropriate scope) and VERCEL_PROJECT_ID +
// optionally VERCEL_TEAM_ID for Team-scoped projects.
//
// Failure mode: every helper returns { ok: false, reason } rather
// than throwing. The UI degrades to "we couldn't reach Vercel —
// retry" without surfacing the Vercel-token in error pages.

function teamQuery(): string {
  return process.env.VERCEL_TEAM_ID
    ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}`
    : "";
}

function authHeader(): Record<string, string> | null {
  const t = process.env.VERCEL_API_TOKEN;
  if (!t) return null;
  return { Authorization: `Bearer ${t}` };
}

function projectId(): string | null {
  return process.env.VERCEL_PROJECT_ID ?? null;
}

export type AddDomainResult =
  | {
      ok: true;
      vercel_domain_id: string;
      verification: Array<{
        type: string;
        domain: string;
        value: string;
        reason: string;
      }>;
    }
  | { ok: false; reason: string };

export async function addDomainToProject(
  hostname: string,
): Promise<AddDomainResult> {
  const auth = authHeader();
  const pid = projectId();
  if (!auth || !pid) return { ok: false, reason: "vercel env not configured" };
  try {
    const res = await fetch(
      `https://api.vercel.com/v10/projects/${pid}/domains${teamQuery()}`,
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: hostname }),
      },
    );
    const json = (await res.json()) as {
      uid?: string;
      verification?: AddDomainResult extends { ok: true }
        ? AddDomainResult["verification"]
        : never;
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        reason:
          json.error?.message ??
          `vercel ${res.status} ${json.error?.code ?? ""}`.trim(),
      };
    }
    return {
      ok: true,
      vercel_domain_id: (json.uid as string) ?? hostname,
      verification: (json.verification ?? []) as AddDomainResult extends { ok: true }
        ? AddDomainResult["verification"]
        : never,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}

export type DomainConfig = {
  configuredBy?: "CNAME" | "A" | null;
  misconfigured?: boolean;
  serviceType?: string;
};

export async function getDomainConfig(
  hostname: string,
): Promise<DomainConfig | null> {
  const auth = authHeader();
  if (!auth) return null;
  try {
    const res = await fetch(
      `https://api.vercel.com/v6/domains/${encodeURIComponent(hostname)}/config${teamQuery()}`,
      { headers: auth },
    );
    if (!res.ok) return null;
    return (await res.json()) as DomainConfig;
  } catch {
    return null;
  }
}

export async function removeDomainFromProject(
  hostname: string,
): Promise<{ ok: boolean; reason?: string }> {
  const auth = authHeader();
  const pid = projectId();
  if (!auth || !pid) return { ok: false, reason: "vercel env not configured" };
  try {
    const res = await fetch(
      `https://api.vercel.com/v9/projects/${pid}/domains/${encodeURIComponent(hostname)}${teamQuery()}`,
      { method: "DELETE", headers: auth },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, reason: `vercel ${res.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}
