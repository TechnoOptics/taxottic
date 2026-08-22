/**
 * Syndication containment: the row that a later fix does not undo.
 *
 * Fleet contract section 6.5, syndication row, new in revision C, with its
 * failure mode in 6.7 ("the feed that publishes to the outside world") and its
 * checklist line in section 11 phase 2 and phase 5.
 *
 * The row covers any path that copies tenant content into a system outside this
 * product, where a later delete on our side does not retract it: a product or
 * listing feed sent to an aggregation service, a public unauthenticated
 * endpoint that serves content to crawlers and third-party AI clients, a
 * sitemap or URL-submission call fired on deploy, an RSS or JSON feed at a
 * fixed URL, a public directory or profile page a crawler reaches with no
 * session.
 *
 * WHY THIS ROW GETS ITS OWN FILE
 *
 * 6.7 states the difference plainly: every other egress failure happens inside
 * a system we control, so fixing the bug ends the exposure. Content that has
 * reached an external index has been copied by parties we cannot reach. No
 * purge, no `remaining` of zero and no `residue` entry retracts it, and open
 * question 24 exists precisely because 8.4's `reason` list has nothing that
 * honestly describes it. So the ordering rule is stronger than for the rest of
 * 6.5: the control comes before the first sandbox tenant exists, not before
 * go-live.
 *
 * WHAT THIS PRODUCT ACTUALLY HAS
 *
 * Enumerated from the codebase and from the deploy pipeline, not from memory:
 *
 *   - `app/sitemap.ts`   the only place a URL is advertised to a search engine
 *   - `app/robots.ts`    the crawl posture that keeps crawlers off tenant routes
 *   - `public/llms.txt`  a static product summary for AI clients
 *   - `public/<hex>.txt` an IndexNow ownership key, with no submitter
 *
 * There is no product feed, no listing feed, no RSS, JSON or CSV feed at a
 * fixed URL, no public directory or profile page, and no deploy-time
 * URL-submission step. Section 6.5 requires that absence to be recorded as a
 * finding and pinned with a test that fails when one appears, "because this is
 * the row a product acquires later without anybody noticing". That is what the
 * last describe block is.
 *
 * The chokepoint 6.5 asks for is "where the payload is built, not where it is
 * sent, because a public endpoint has no session to check and a feed job has no
 * user". For this product the payload is built in `app/sitemap.ts`, so the
 * control is that the builder reads no tenant data at all: every URL it emits
 * is a literal or comes from a static data module. A sandbox tenant cannot
 * reach a list it is not read into.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");

/** Strip comments. A control named in prose is not a control. */
function code(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/[^\n]*/g, "");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|mjs)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const APP_AND_LIB = ["app", "lib", "scripts"].flatMap((d) =>
  sourceFiles(join(REPO_ROOT, d)),
);

const SITEMAP = "app/sitemap.ts";
const ROBOTS = "app/robots.ts";

describe("the syndication scan is not vacuous", () => {
  it("reads the two payload builders and a realistic tree", () => {
    // Guards the guard. Every assertion below is either a negative or a set
    // comparison, and both pass silently over nothing.
    expect(code(SITEMAP).length).toBeGreaterThan(2000);
    expect(code(ROBOTS).length).toBeGreaterThan(1000);
    expect(APP_AND_LIB.length).toBeGreaterThan(500);
  });
});

describe("the sitemap payload is built without reading tenant data", () => {
  /**
   * The chokepoint. 6.5: "The chokepoint is where the payload is built, not
   * where it is sent, because a public endpoint has no session to check and a
   * feed job has no user."
   *
   * `app/sitemap.ts` builds the one payload this product hands a search engine.
   * It reads `headers()` to pick a host and imports two static data modules,
   * and that is all. The moment it acquires a database read, a sandbox tenant's
   * URL can be advertised to Google, and no purge takes it back.
   */
  const TENANT_READ_PROBES: { name: string; re: RegExp }[] = [
    { name: "the service-role client", re: /createServiceClient/ },
    { name: "a Supabase client", re: /@\/lib\/supabase|createClient\s*\(/ },
    { name: "a PostgREST table read", re: /\.from\s*\(\s*["'`]/ },
    { name: "a stored procedure call", re: /\.rpc\s*\(/ },
  ];

  for (const probe of TENANT_READ_PROBES) {
    it(`does not reach the database through ${probe.name}`, () => {
      expect(
        probe.re.test(code(SITEMAP)),
        `${SITEMAP} acquired ${probe.name}. Section 6.5's syndication row: no ` +
          `sandbox tenant's content may enter a search engine's index, and ` +
          `unlike every other egress row, fixing this afterwards does not undo ` +
          `it. If the sitemap must list tenant content, the sandbox exclusion ` +
          `goes here, in the builder, and it must fail closed when it cannot ` +
          `determine tenancy.`,
      ).toBe(false);
    });
  }

  it("emits no dynamic route segment", () => {
    // A `[publicId]` in a sitemap URL means the list is being built from rows
    // rather than from literals, which is the same finding as above arriving
    // through a different door.
    const urls = [...code(SITEMAP).matchAll(/\$\{baseUrl\}([^`"']*)/g)].map(
      (m) => m[1],
    );
    expect(
      urls.length,
      "sitemap URL literals moved or were renamed",
    ).toBeGreaterThan(10);
    for (const u of urls) {
      expect(u.includes("["), `sitemap URL ${u} carries a dynamic segment`).toBe(
        false,
      );
    }
  });

  it("imports only the static modules its URL lists are built from", () => {
    /**
     * The four TENANT_READ_PROBES above catch a database call written in this
     * file. They do not catch one written in a module this file imports, which
     * is the shape a helper refactor produces. So the import set is fixed:
     * `next` for the type, `next/headers` for the host, and the two calculator
     * data modules whose exports are the `/calculators/self-employment-tax/...`
     * URL lists. All four are computed from checked-in constants and the tax
     * engine, with no data source of their own.
     */
    const imports = [...code(SITEMAP).matchAll(/from\s+["']([^"']+)["']/g)]
      .map((m) => m[1])
      .sort();
    expect(
      imports,
      "app/sitemap.ts gained an import. Every URL it advertises to a search " +
        "engine must still come from a literal or a static module, because a " +
        "sandbox URL that reaches an index is not retractable by any purge.",
    ).toEqual([
      "@/lib/calculators/incomes",
      "@/lib/calculators/states",
      "next",
      "next/headers",
    ]);
  });
});

describe("robots.txt keeps crawlers off every tenant route tree", () => {
  /**
   * The second half of the control. Even with a clean sitemap, a crawler that
   * finds a tenant URL by a link follows it. Every authenticated route tree is
   * disallowed, so a sandbox tenant's page is not fetched in the first place.
   *
   * This is asserted rather than assumed because the disallow list is ordinary
   * marketing configuration that somebody will edit for an SEO reason, and the
   * consequence of dropping one line here is not an SEO regression.
   */
  const TENANT_ROUTE_TREES = [
    "/c/",
    "/dashboard",
    "/personal/",
    "/firm",
    "/settings",
    "/billing",
    "/goals",
    "/reminders",
    "/bella",
    "/admin",
    "/api/",
  ];

  for (const tree of TENANT_ROUTE_TREES) {
    it(`disallows ${tree}`, () => {
      const src = code(ROBOTS);
      const disallow = src.slice(src.indexOf("const disallow"));
      expect(
        new RegExp(`["']${tree.replace(/\//g, "\\/")}["']`).test(disallow),
        `${ROBOTS} no longer disallows ${tree}. A crawler that reaches a ` +
          `sandbox tenant's page indexes it, and section 6.5's syndication row ` +
          `is the one egress class a later fix does not undo.`,
      ).toBe(true);
    });
  }
});

describe("no other syndication path exists in this product", () => {
  /**
   * The finding, pinned. Section 6.5: "If your product has none of these paths,
   * record that as a finding and pin it with a test that fails when one
   * appears, because this is the row a product acquires later without anybody
   * noticing." Section 11 phase 5 says the same in test form.
   *
   * Each assertion below is one of the versions 6.5 lists, so that the absence
   * is recorded per version rather than as one blanket claim.
   */

  it("publishes no feed at a fixed URL", () => {
    // An RSS, Atom, JSON or CSV feed is a Next.js route whose segment says so.
    const routes = APP_AND_LIB.filter((f) => f.startsWith(join(REPO_ROOT, "app")))
      .map((f) => f.slice(REPO_ROOT.length + 1))
      .filter((f) => /\/(feed|rss|atom)(\.xml)?\/(route|page)\.tsx?$/.test(f));
    expect(
      routes,
      "a feed route appeared. Before it ships, decide how it excludes a " +
        "sandbox tenant: the check goes where the payload is built, and it " +
        "must fail closed when it cannot determine tenancy.",
    ).toEqual([]);
  });

  it("sends no product, listing or catalog feed to an outside service", () => {
    const probes =
      /merchant(s)?\.google|content\.googleapis|shopping\/content|facebook\.com\/.*catalog|feeds?\.(atom|rss)|productFeed|listingFeed/i;
    const hits = APP_AND_LIB.filter((f) => {
      const src = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<!:)\/\/[^\n]*/g, "");
      return probes.test(src);
    }).map((f) => f.slice(REPO_ROOT.length + 1));
    expect(
      hits,
      "a feed to an outside service appeared. Content that reaches it has been " +
        "copied by parties we cannot reach, and open question 24 records that " +
        "nothing in 8.4's reason list describes that state.",
    ).toEqual([]);
  });

  it("submits no URL to any external index, from code or from the deploy pipeline", () => {
    /**
     * `public/3469b3d10dc2eca4e1d9cbc4936e46b2.txt` is an IndexNow ownership
     * key. A key proves who owns the host; it does not submit anything. There
     * is no submitter in this repository and no submission step in the deploy
     * pipeline, which is what makes 6.5's "where the path is a deploy or build
     * step ... the check belongs in the step" vacuous here rather than unmet.
     *
     * If a submitter is added, this fails, and whoever adds it has to build the
     * fail-closed tenancy check before the suite goes green. That is the
     * decision 6.5 wants made once rather than discovered in a search result.
     */
    const SUBMIT =
      /api\.indexnow\.org|indexnow\.org\/indexnow|indexing\.googleapis\.com|urlNotifications|\/ping\?sitemap=|www\.bing\.com\/(webmaster|ping)|searchconsole\/v1|submitUrl\s*\(/i;

    const codeHits = APP_AND_LIB.filter((f) => {
      const src = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<!:)\/\/[^\n]*/g, "");
      return SUBMIT.test(src);
    }).map((f) => f.slice(REPO_ROOT.length + 1));
    expect(codeHits, "a URL submitter appeared in application code").toEqual([]);

    // The deploy pipeline, enumerated the same way: the scripts npm can run,
    // the crons Vercel runs, and every workflow CI runs.
    const pipeline = [
      "package.json",
      "vercel.json",
      ...readdirSync(join(REPO_ROOT, ".github", "workflows")).map((f) =>
        join(".github", "workflows", f),
      ),
    ];
    const pipelineHits = pipeline.filter((rel) =>
      SUBMIT.test(readFileSync(join(REPO_ROOT, rel), "utf8")),
    );
    expect(
      pipelineHits,
      "a deploy-time submission step appeared. Section 6.5: where the path is " +
        "a deploy or build step rather than a request, the check belongs in " +
        "the step, and the step must fail closed when it cannot determine " +
        "tenancy.",
    ).toEqual([]);
    // Guards the guard: the pipeline list must be real files, not an empty
    // glob that makes the assertion above pass over nothing.
    expect(pipeline.length).toBeGreaterThan(5);
  });

  it("serves no crawler-facing file that anything generates", () => {
    /**
     * `public/llms.txt` and the IndexNow key are public unauthenticated content
     * endpoints in 6.5's sense: a crawler or an AI client fetches them with no
     * session, and `middleware.ts` deliberately exempts root-level `.txt` from
     * the auth redirect so they can. Both are checked-in literals describing
     * the product, so they carry no tenant content by construction.
     *
     * The property worth holding is that construction: nothing writes them. A
     * generated llms.txt is a payload builder, and it would need the same
     * check `app/sitemap.ts` is asserted to need above.
     */
    const CRAWLER_FILES = ["llms.txt", "3469b3d10dc2eca4e1d9cbc4936e46b2.txt"];
    for (const f of CRAWLER_FILES) {
      expect(
        readFileSync(join(REPO_ROOT, "public", f), "utf8").length,
        `public/${f} is gone. It is fetched by crawlers with no session.`,
      ).toBeGreaterThan(0);
    }
    const writers = APP_AND_LIB.filter((f) => {
      const src = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<!:)\/\/[^\n]*/g, "");
      return CRAWLER_FILES.some((c) => src.includes(c));
    }).map((f) => f.slice(REPO_ROOT.length + 1));
    expect(
      writers,
      "something now references a crawler-facing public file. If it generates " +
        "it, that file became a syndication payload builder and needs the " +
        "sandbox check at the point of construction.",
    ).toEqual([]);
  });
});
