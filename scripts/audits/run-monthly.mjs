// Runs every monthly compliance audit and writes the markdown + branded PDF
// reports to the OneDrive Compliance folder, organised as <YYYY>/<MM>/.
//
// Usage:
//   node scripts/audits/run-monthly.mjs            # current month
//   node scripts/audits/run-monthly.mjs 2026-05    # specific month

import { mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const COMPLIANCE_BASE =
  process.env.TAXOTTIC_COMPLIANCE_BASE ||
  "C:/Users/abelm/OneDrive - technooptics.org/Group Of Compannies/Taxottic/Documents for Plaid/Compliance";

const arg = process.argv[2];
const now = new Date();
let year, month;
if (arg && /^\d{4}-\d{2}$/.test(arg)) {
  [year, month] = arg.split("-");
} else {
  year = String(now.getFullYear());
  month = String(now.getMonth() + 1).padStart(2, "0");
}

const targetDir = path.join(COMPLIANCE_BASE, year, month);
if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

const audits = [
  { id: "01-vulnerability-scan", title: "Vulnerability Scan", script: "scripts/audits/vulnerability-scan.mjs" },
  { id: "02-access-control-review", title: "Access Control Review", script: "scripts/audits/access-control-review.mjs" },
  { id: "03-zero-trust-attestation", title: "Zero-Trust Architecture Attestation", script: "scripts/audits/zero-trust-attestation.mjs" },
  { id: "04-secure-tokens-review", title: "Secure Tokens and Certificates Review", script: "scripts/audits/secure-tokens-review.mjs" },
  { id: "05-tls-headers-scan", title: "TLS and Security Headers Scan", script: "scripts/audits/tls-headers-scan.mjs" },
  { id: "06-dependency-freshness", title: "Dependency Freshness Review", script: "scripts/audits/dependency-freshness.mjs" },
];

const results = [];
for (const a of audits) {
  const mdPath = path.join(targetDir, `${a.id}.md`);
  const pdfPath = path.join(targetDir, `${a.id}.pdf`);
  process.stdout.write(`==> ${a.title}\n`);
  try {
    execFileSync("node", [a.script, mdPath], { stdio: "inherit" });
    execFileSync("node", ["scripts/md-to-pdf.mjs", mdPath, pdfPath], { stdio: "inherit" });
    results.push({ ...a, status: "ok", pdf: pdfPath });
  } catch (e) {
    results.push({ ...a, status: "error", error: String(e.message || e) });
  }
}

console.log("\n--- Monthly audit run complete ---");
console.log(`Output dir: ${targetDir}`);
for (const r of results) {
  console.log(`  ${r.status === "ok" ? "[OK]   " : "[FAIL] "} ${r.id}.pdf`);
}
const failed = results.filter((r) => r.status !== "ok");
if (failed.length) process.exit(1);
