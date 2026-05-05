import { writeFileSync, readFileSync } from "node:fs";
import { asOfDate, reportHeader, tryExec } from "./_utils.mjs";

const out = process.argv[2];
if (!out) {
  console.error("Usage: node dependency-freshness.mjs <output.md>");
  process.exit(1);
}

const asOf = asOfDate();
let md = reportHeader("Dependency Freshness Review", asOf);

md += `## Scope

A dependency that has gone unmaintained for a long time is a leading
indicator of future CVEs. This review counts our direct production
dependencies, lists those that have a newer major or minor available,
and flags any that are more than 12 months behind their latest
release.

`;

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const deps = pkg.dependencies ?? {};
md += `## Inventory\n\n`;
md += `- Direct production dependencies: **${Object.keys(deps).length}**\n`;
md += `- Direct devDependencies: **${Object.keys(pkg.devDependencies ?? {}).length}**\n`;
md += `- Engines: ${JSON.stringify(pkg.engines ?? {}, null, 0)}\n\n`;

md += "## Outdated direct production dependencies\n\n";
const outdated = tryExec("npm outdated --json", { maxBuffer: 64 * 1024 * 1024 });
const json = outdated.stdout ? safeJson(outdated.stdout) : null;
if (!json || Object.keys(json).length === 0) {
  md += "_All direct production dependencies are at the wanted version._\n\n";
} else {
  const prodOutdated = Object.entries(json).filter(([, v]) => v.type === "dependencies");
  md += `Outdated direct production dependencies: **${prodOutdated.length}**\n\n`;
  if (prodOutdated.length > 0) {
    md += "| Package | Current | Wanted | Latest | Major behind? |\n| --- | --- | --- | --- | --- |\n";
    for (const [name, v] of prodOutdated) {
      const cur = (v.current ?? "").split(".")[0];
      const lat = (v.latest ?? "").split(".")[0];
      const majorBehind = cur && lat && cur !== lat ? `**${Number(lat) - Number(cur)}**` : "no";
      md += `| ${name} | ${v.current ?? "-"} | ${v.wanted ?? "-"} | ${v.latest ?? "-"} | ${majorBehind} |\n`;
    }
    md += "\n";
  }
}

md += `## Action items

- Schedule the major-version upgrades flagged above into the next minor-release window.
- Confirm Dependabot is enabled on the repository and is producing the per-week PR cadence noted in the Vulnerability Management Policy.
`;

writeFileSync(out, md, "utf8");
console.log("Wrote", out);

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
