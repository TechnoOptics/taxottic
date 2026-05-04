import { writeFileSync } from "node:fs";
import { asOfDate, reportHeader } from "./_utils.mjs";

const out = process.argv[2];
if (!out) {
  console.error("Usage: node tls-headers-scan.mjs <output.md>");
  process.exit(1);
}

const asOf = asOfDate();
let md = reportHeader("TLS and Security Headers Scan", asOf);

md += `## Scope

This scan checks the live production endpoints (\`taxottic.com\` and
\`hq.taxottic.com\`) for the security-relevant HTTP response headers
that Plaid, Google OAuth review, and modern browsers expect:

- \`Strict-Transport-Security\` (HSTS) — forces HTTPS.
- \`Content-Security-Policy\` (CSP) — limits what scripts/origins can load.
- \`X-Frame-Options\` / \`Content-Security-Policy: frame-ancestors\` — clickjacking defence.
- \`X-Content-Type-Options: nosniff\` — MIME-sniffing defence.
- \`Referrer-Policy\` — leak-prevention.

`;

const targets = ["https://taxottic.com/", "https://hq.taxottic.com/"];
const required = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
];
const recommended = ["x-frame-options", "permissions-policy"];

for (const url of targets) {
  md += `## ${url}\n\n`;
  let res;
  try {
    res = await fetch(url, { redirect: "follow", method: "GET" });
  } catch (e) {
    md += `_Fetch failed: ${String(e.message || e)}_\n\n`;
    continue;
  }
  md += `Final status: **${res.status}** ${res.statusText}\n\n`;

  md += "| Header | Status | Value (truncated) |\n| --- | --- | --- |\n";
  for (const h of [...required, ...recommended]) {
    const v = res.headers.get(h);
    const present = v != null;
    const isRequired = required.includes(h);
    const status = present ? "PASS" : isRequired ? "FAIL" : "WARN";
    const val = v ? v.slice(0, 80).replace(/\|/g, "\\|") : "_(absent)_";
    md += `| \`${h}\` | ${status} | ${val} |\n`;
  }
  md += "\n";

  const hsts = res.headers.get("strict-transport-security") ?? "";
  const m = hsts.match(/max-age=(\d+)/i);
  if (m) {
    const days = Math.round(Number(m[1]) / 86400);
    md += `HSTS \`max-age\`: ${m[1]} seconds (~${days} days). Recommended: 6 months (15552000) or longer with preload.\n\n`;
  }
}

md += `## Action items

- Any **FAIL** for a required header must be fixed in \`next.config.ts\` headers config and re-deployed within the High SLA tier (30 days).
- **WARN** rows are defence-in-depth; they should be added at the next minor-release window.
`;

writeFileSync(out, md, "utf8");
console.log("Wrote", out);
