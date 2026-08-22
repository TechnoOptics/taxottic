/**
 * Egress containment: the chokepoint inventory, held in place.
 *
 * Fleet contract section 6.5. Data isolation stops a sandbox user reading a
 * real row; it does nothing to stop our own code acting on a sandbox row in
 * the real world. Every path out needs ONE chokepoint that knows about the
 * `sandbox` flag, "at the chokepoint, not at each call site", because a check
 * at each call site is the mechanism 6.2 rejects wearing different clothes.
 *
 * WHAT THIS FILE DOES AND DOES NOT DO
 *
 * It does not implement the sandbox checks. It cannot yet: the checks read
 * `companies.sandbox`, and this repo's rule is that an additive column
 * reaches production BEFORE the code that reads it merges, or PostgREST
 * answers 42703 and the reading path silently returns nothing. Wiring the
 * checks is the next PR, after 20260819010000_hq_sandbox_boundary.sql is
 * applied.
 *
 * What it does is fix the inventory in place first, which is the part that
 * would otherwise rot between the two PRs. Each assertion says: this egress
 * path leaves the process HERE, in these files and no others. When the checks
 * land they go in these files. If a tenth file starts constructing an
 * Anthropic client next month, this fails, and the person adding it finds out
 * that they have opened a new way for a sandbox row to reach a third party.
 *
 * Two of these lists record a chokepoint that is already broken. That is
 * deliberate: an accurate list of three Stripe constructors is worth more
 * than an aspirational list of one, and the entry says so.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const SCANNED_DIRS = ["app", "lib"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip comments. A chokepoint named in prose is not a chokepoint.
 *
 * The `(?<!:)` matters and is not defensive noise: a naive `\/\/[^\n]*` eats
 * the rest of the line from the `//` in `https://api.resend.com/emails`, so
 * the one real email chokepoint in this codebase reads as zero and the whole
 * assertion inverts. Caught by watching this file fail.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "");
}

const ALL_FILES = SCANNED_DIRS.flatMap((d) => sourceFiles(join(REPO_ROOT, d)));

function filesMatching(re: RegExp): string[] {
  return ALL_FILES.filter((f) => re.test(code(f)))
    .map((f) => f.slice(REPO_ROOT.length + 1))
    .sort();
}

type Chokepoint = {
  /** The 6.5 egress path this covers. */
  path: string;
  /** What "leaving the process" looks like in source. */
  probe: RegExp;
  /** Every file allowed to contain it, with why. */
  sites: { file: string; note: string }[];
};

const CHOKEPOINTS: Chokepoint[] = [
  {
    path: "Transactional email",
    probe: /api\.resend\.com/,
    sites: [
      {
        file: "lib/email/transport.ts",
        note:
          "sendEmail(). The single place a message reaches Resend. This is " +
          "where the sandbox allowlist goes: the prospect's own address plus " +
          "anyone they invited into their own sandbox tenant, everything " +
          "else dropped and counted.",
      },
    ],
  },
  {
    path: "Web push",
    probe: /import\(\s*["']web-push["']\s*\)/,
    sites: [
      {
        file: "lib/push/providers.ts",
        note:
          "resolveProvider(). APNs, FCM and web push all exit here, behind " +
          "notify() in lib/push/index.ts. The best-factored egress path in " +
          "the codebase and the easiest one to gate.",
      },
    ],
  },
  {
    path: "Payments and billing",
    probe: /new\s+Stripe\s*\(/,
    sites: [
      {
        file: "lib/stripe/server.ts",
        note: "getStripe(). The sanctioned singleton.",
      },
      {
        file: "lib/firm/payments/stripe-connect.ts",
        note:
          "ALREADY A VIOLATION of 6.5's one-chokepoint rule: a second " +
          "module-private client with a hand-copied apiVersion. Listed so " +
          "the count is honest. A sandbox gate has to go here as well as in " +
          "lib/stripe/server.ts until this is folded back in.",
      },
      {
        file: "app/api/firm/billing/portal/route.ts",
        note:
          "ALREADY A VIOLATION: a client constructed inline in a route " +
          "handler. Same consequence as the entry above.",
      },
    ],
  },
  {
    path: "Banking integration",
    probe: /new\s+PlaidApi\s*\(/,
    sites: [
      {
        file: "lib/plaid/client.ts",
        note:
          "getPlaidClient(). One construction, five consumers. 6.5: no " +
          "sandbox tenant may hold live third-party credentials, and the " +
          "delivery layer refuses to dispatch rather than the config screen " +
          "refusing to save.",
      },
    ],
  },
  {
    path: "Vector stores and AI features",
    probe: /new\s+Anthropic\s*\(/,
    sites: [
      {
        file: "app/api/bella/route.ts",
        note:
          "The in-app assistant. Sends the tax profile, company financials " +
          "and retrieved knowledge-base text off-platform on every turn.",
      },
      {
        file: "lib/csv/bella-categorize.ts",
        note: "Bulk transaction categorisation. Sends bank descriptions and amounts.",
      },
      {
        file: "lib/ocr/extract-paystub.ts",
        note: "Paystub extraction. Sends a document image carrying wages and a name.",
      },
      {
        file: "lib/ocr/extract-receipt.ts",
        note: "Receipt extraction. Sends a photographed receipt image.",
      },
      {
        file: "lib/ocr/extract-tax-doc.ts",
        note: "Generic tax document extraction. Sends a prior-year return image.",
      },
      {
        file: "lib/ocr/extract-w2.ts",
        note: "W-2 extraction. Sends a document image carrying an SSN.",
      },
    ],
  },
];

describe("the chokepoint scan is not vacuous", () => {
  it("reads a realistic number of source files", () => {
    expect(ALL_FILES.length).toBeGreaterThan(500);
  });

  it("strips comments, so a chokepoint named in prose does not count", () => {
    // lib/push/web.ts mentions web-push in a comment and constructs nothing.
    expect(filesMatching(/import\(\s*["']web-push["']\s*\)/)).not.toContain(
      "lib/push/web.ts",
    );
  });

  it("finds each probe somewhere", () => {
    for (const c of CHOKEPOINTS) {
      expect(filesMatching(c.probe).length, c.path).toBeGreaterThan(0);
    }
  });
});

describe("every egress path leaves the process where the inventory says", () => {
  for (const c of CHOKEPOINTS) {
    it(`${c.path}`, () => {
      const expected = c.sites.map((s) => s.file).sort();
      const actual = filesMatching(c.probe);
      expect(
        actual,
        `${c.path}: the set of files that reach this third party changed. ` +
          `Section 6.5 requires the sandbox check at the chokepoint, so a new ` +
          `file here is a new way for a sandbox tenant's row to reach the ` +
          `real world. Add it to CHOKEPOINTS with a note, or route it through ` +
          `the existing chokepoint.`,
      ).toEqual(expected);
    });
  }

  it("gives a reason for every site it allows", () => {
    for (const c of CHOKEPOINTS) {
      for (const s of c.sites) {
        expect(s.note.length, `${c.path}: ${s.file} has no note`).toBeGreaterThan(20);
      }
    }
  });
});

describe("nothing embeds tenant content into a shared collection", () => {
  /**
   * The README's product note for Taxottic:
   *
   *   "Sandbox content must not be embedded into any collection that a real
   *    tenant's retrieval can reach, and must not enter any training,
   *    evaluation, or fine-tuning set."
   *
   * Today that holds for a reason worth writing down: tax_kb_chunks has an
   * `embedding vector(1024)` column and an HNSW index, and NOTHING IN THIS
   * REPOSITORY WRITES TO IT. bella_kb_search is trigram-only. The knowledge
   * base is published tax guidance, not tenant content, and retrieval is a
   * text-similarity query over it.
   *
   * That is a safe state held by absence, which is the kind that ends
   * quietly. This test is what makes it end loudly instead: the day someone
   * wires an embedding producer, they have to decide where sandbox content
   * goes before the test will pass, which is the decision 6.5 wants made once
   * rather than discovered later.
   */
  it("has no embedding producer", () => {
    const producers = filesMatching(
      /embeddings?\s*\.\s*create|voyageai|\bvoyage[-_]?\d|createEmbedding|\.embed\s*\(/i,
    );
    expect(
      producers,
      "an embedding producer appeared. Before this ships, decide where a " +
        "sandbox tenant's vectors live: 6.5 requires a separate index or " +
        "namespace, never a shared collection with a query-time filter, and " +
        "8.1 makes embeddings an explicit purge class.",
    ).toEqual([]);
  });

  it("writes nothing to tax_kb_chunks", () => {
    /**
     * The probe requires the write to be chained off `from("tax_kb_chunks")`
     * rather than merely co-located with the table's name. The looser version
     * matched any file that mentioned the table anywhere and also called any
     * method named `delete`, which is true of `Map.delete` in
     * lib/hq/catalog.ts. A guard that fires on a Map operation is a guard
     * somebody switches off.
     */
    const writers = ALL_FILES.filter((f) =>
      /from\s*\(\s*["'`]tax_kb_chunks["'`]\s*\)[\s\S]{0,400}?\.(insert|upsert|update|delete)\s*\(/.test(
        code(f),
      ),
    ).map((f) => f.slice(REPO_ROOT.length + 1));
    expect(
      writers,
      "tax_kb_chunks is the corpus every tenant's assistant retrieves from. " +
        "A write path into it from tenant code is how sandbox content reaches " +
        "a real tenant's retrieval.",
    ).toEqual([]);
  });
});
