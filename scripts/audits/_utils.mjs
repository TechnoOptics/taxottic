import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

export function asOfDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function reportHeader(title, asOf) {
  return `# ${title}

**As of:** ${asOf}
**Organization:** Techno Optics LLC (operating Taxottic)
**Owner:** Information Security Lead

`;
}

export function tryExec(cmd, opts = {}) {
  try {
    return {
      ok: true,
      stdout: execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts }),
    };
  } catch (e) {
    return { ok: false, stdout: e.stdout?.toString?.() ?? "", stderr: e.stderr?.toString?.() ?? "", code: e.status };
  }
}

export function listMigrations() {
  const dir = "supabase/migrations";
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

export function readAllMigrations() {
  return listMigrations().map((f) => ({ file: f, content: readFileSync(path.join("supabase/migrations", f), "utf8") }));
}

export function repoFileExists(p) {
  return existsSync(p);
}

export function readRepoFile(p) {
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}
