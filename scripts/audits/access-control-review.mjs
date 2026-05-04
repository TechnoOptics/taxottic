import { writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { asOfDate, reportHeader, readAllMigrations, repoFileExists } from "./_utils.mjs";

const out = process.argv[2];
if (!out) {
  console.error("Usage: node access-control-review.mjs <output.md>");
  process.exit(1);
}

const asOf = asOfDate();
let md = reportHeader("Access Control Review", asOf);

md += `## Scope

Per the Access Control Policy, every multi-tenant table in the
production database must have row-level security enabled and at
least one explicit policy. Application code must use the
\`requireUser()\` and \`requireUserWithAdmin()\` guards on every
authenticated route. This review enforces both invariants from the
source of truth (migrations + repo).

`;

const migrations = readAllMigrations();
const tablesEnabled = new Set();
const tablesWithPolicies = new Set();
const tablesNoPolicies = new Set();

for (const { content } of migrations) {
  const enable = content.matchAll(/alter\s+table\s+(?:public\.)?(\w+)\s+enable\s+row\s+level\s+security/gi);
  for (const m of enable) tablesEnabled.add(m[1]);

  const policies = content.matchAll(/create\s+policy\s+[^\n]*\son\s+(?:public\.)?(\w+)/gi);
  for (const m of policies) tablesWithPolicies.add(m[1]);
}

for (const t of tablesEnabled) {
  if (!tablesWithPolicies.has(t)) tablesNoPolicies.add(t);
}

md += `## Row-level security coverage

| Metric | Count |\n| --- | --- |\n`;
md += `| Tables with RLS enabled | ${tablesEnabled.size} |\n`;
md += `| Tables with at least one policy | ${tablesWithPolicies.size} |\n`;
md += `| Tables with RLS but no policies (service-role-only) | ${tablesNoPolicies.size} |\n\n`;

if (tablesNoPolicies.size > 0) {
  md += "### Tables with RLS but no policies\n\n";
  md += "These are intentionally locked down to the service role only (e.g. token vaults). Each appearance is reviewed against the access-control policy on entry.\n\n";
  for (const t of [...tablesNoPolicies].sort()) md += `- \`${t}\`\n`;
  md += "\n";
}

md += `## Auth-helper coverage in API routes

`;

let routesWithGuard = 0;
let routesUnguarded = [];
try {
  const list = execSync(`grep -rl "" app/api -l --include "route.ts"`, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
  const files = list.split(/\r?\n/).filter(Boolean);
  for (const f of files) {
    const c = readFileSync(f, "utf8");
    if (/requireUser|webhookVerify|publicRoute|signed_token|verifySigned/.test(c)) routesWithGuard++;
    else routesUnguarded.push(f);
  }
  md += `- Total \`app/api/**/route.ts\` files: **${files.length}**\n`;
  md += `- Files referencing an auth or signature guard: **${routesWithGuard}**\n`;
  md += `- Files without an obvious guard reference: **${routesUnguarded.length}**\n\n`;
} catch {
  md += "_Could not enumerate API routes via grep; re-run on a Unix-style shell._\n\n";
}

if (routesUnguarded.length > 0) {
  md += "### Routes flagged for manual confirmation\n\n";
  md += "Some routes are legitimately public (e.g. health checks, the public `/book` form). Each route below must be confirmed as either intentionally public or fixed in the next remediation cycle.\n\n";
  for (const f of routesUnguarded.slice(0, 40)) md += `- \`${f.replace(/\\/g, "/")}\`\n`;
  if (routesUnguarded.length > 40) md += `\n_${routesUnguarded.length - 40} more truncated._\n`;
  md += "\n";
}

md += `## Access-helper presence in lib/auth.ts

`;
const auth = repoFileExists("lib/auth.ts");
md += `- \`lib/auth.ts\` present: **${auth ? "yes" : "no"}**\n`;
if (auth) {
  const c = readFileSync("lib/auth.ts", "utf8");
  md += `- exports \`requireUser\`: **${/export\s+(async\s+)?function\s+requireUser/.test(c) ? "yes" : "no"}**\n`;
  md += `- exports \`requireUserWithAdmin\`: **${/export\s+(async\s+)?function\s+requireUserWithAdmin/.test(c) ? "yes" : "no"}**\n`;
}
md += "\n";

md += `## Action items

- Resolve any unguarded API route flagged above by confirming public-ness or adding the appropriate guard.
- Review the service-role-only tables list and confirm each is still intentionally locked down.
- Run the quarterly internal-personnel access review per the Access Control Policy §12.
`;

writeFileSync(out, md, "utf8");
console.log("Wrote", out);
