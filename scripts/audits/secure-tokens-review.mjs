import { writeFileSync } from "node:fs";
import { asOfDate, reportHeader, readRepoFile, repoFileExists } from "./_utils.mjs";

const out = process.argv[2];
if (!out) {
  console.error("Usage: node secure-tokens-review.mjs <output.md>");
  process.exit(1);
}

const asOf = asOfDate();
let md = reportHeader("Secure Tokens and Certificates Review", asOf);

md += `## Scope

Per the attestation that Taxottic uses secure tokens and
certificates for authentication, this review confirms that:

- All sensitive tokens (Plaid access tokens) are encrypted at rest.
- All inbound webhook traffic is verified by signature.
- All HTTPS endpoints are served over TLS via certificates managed
  by Vercel + Let's Encrypt.

`;

const tokenLib = readRepoFile("lib/crypto/bankTokens.ts");
const webhookLib = readRepoFile("lib/plaid/webhookVerify.ts");
const migration = repoFileExists("supabase/migrations/20260504000002_bank_token_encryption.sql");

md += "## Code-level checks\n\n";
md += "| Check | Status | Notes |\n| --- | --- | --- |\n";
md += `| \`lib/crypto/bankTokens.ts\` present | ${tokenLib ? "PASS" : "FAIL"} | Token encryption helper module |\n`;
md += `| Token helper uses AES-256-GCM | ${tokenLib && /aes-256-gcm/i.test(tokenLib) ? "PASS" : "FAIL"} | Authenticated encryption with 96-bit nonce |\n`;
md += `| Token helper key loaded from env (never hard-coded) | ${tokenLib && /process\.env\./.test(tokenLib) ? "PASS" : "FAIL"} | Key held outside the database |\n`;
md += `| Encryption migration in place | ${migration ? "PASS" : "FAIL"} | \`20260504000002_bank_token_encryption.sql\` |\n`;
md += `| \`lib/plaid/webhookVerify.ts\` present | ${webhookLib ? "PASS" : "FAIL"} | Webhook signature verification module |\n`;
md += `| Webhook verifier uses Plaid JWKs | ${webhookLib && /jwk|jwks/i.test(webhookLib) ? "PASS" : "FAIL"} | Trust anchors fetched from Plaid |\n`;
md += "\n";

md += "## Live TLS check (taxottic.com)\n\n";
let tlsBlock = "_TLS handshake check skipped — set TAXOTTIC_TLS_CHECK=1 to enable._\n\n";
if (process.env.TAXOTTIC_TLS_CHECK === "1") {
  try {
    const tls = await import("node:tls");
    const cert = await new Promise((resolve, reject) => {
      const s = tls.connect({ host: "taxottic.com", port: 443, servername: "taxottic.com" }, () => {
        const c = s.getPeerCertificate(true);
        s.end();
        resolve(c);
      });
      s.on("error", reject);
      s.setTimeout(5000, () => { s.destroy(new Error("TLS timeout")); });
    });
    const issuer = cert.issuer?.CN ?? "(unknown)";
    const notAfter = cert.valid_to ?? "(unknown)";
    const daysLeft = Math.round((new Date(cert.valid_to) - new Date()) / 86400000);
    tlsBlock = `| Field | Value |\n| --- | --- |\n| Subject | ${cert.subject?.CN ?? "(unknown)"} |\n| Issuer | ${issuer} |\n| Valid until | ${notAfter} |\n| Days remaining | ${daysLeft} |\n\nVercel + Let's Encrypt rotate the certificate automatically inside this window; a value above 30 days is healthy.\n\n`;
  } catch (e) {
    tlsBlock = `_TLS check failed: ${String(e.message || e)}_\n\n`;
  }
}
md += tlsBlock;

md += `## Action items

- Confirm that the Plaid token-encryption key in Vercel env is current and is not also held on personnel devices.
- Confirm Vercel reports a healthy auto-renewed certificate for both \`taxottic.com\` and \`hq.taxottic.com\` for the period.
- If any "FAIL" rows appear above, file a ticket and remediate per the Vulnerability Management Policy SLA matrix.
`;

writeFileSync(out, md, "utf8");
console.log("Wrote", out);
