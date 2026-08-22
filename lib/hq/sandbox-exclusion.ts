/**
 * The one place that decides a sandbox tenant's rows are not in an elevated
 * read.
 *
 * WHY THIS EXISTS
 *
 * Fleet contract section 6.3, revision C: "The predicate must bind your own
 * elevated code paths, and this is the part that is missed. ... On at least
 * one widely used platform the application's own service role carries a
 * bypass attribute by default, and every call site holding it sits outside
 * the boundary until it is bound to a tenant." That is this platform.
 * Measured on production project enisnjjbxqaliydepacc: `service_role` has
 * `rolbypassrls = true`, so the `hq_sandbox_barrier` restrictive policy the
 * boundary migration installs on 39 tables is not evaluated for any query a
 * service-role client issues.
 *
 * WHY IT IS A FETCH WRAPPER AND NOT A FILTER PER QUERY
 *
 * 6.5: "The check belongs at the chokepoint, not at each call site. A check
 * at each call site is the rejected mechanism in 6.2 wearing different
 * clothes." A Supabase client is built with a `fetch`, and every PostgREST
 * request it ever issues goes through that one function. Rewriting the URL
 * there binds every read the client makes, including reads written after this
 * file, without the reading code naming the boundary or knowing it exists.
 *
 * WHAT IT DOES NOT DO, STATED PLAINLY
 *
 * It binds READS. A write, an rpc and a Storage or Auth call are not
 * rewritten; an rpc is refused outright rather than passed, because a
 * function body runs as the service role and there is no filter to add to it.
 * It is applied to the console client only, not to every service-role client
 * in the repository. `docs/design/fleet-integration.md` carries the
 * classification of the sites that are still unbound and the reason for each.
 */

/** The sandbox side of the boundary, as ids, resolved once per client. */
export type SandboxRealm = {
  /** `companies.id` for every row with `sandbox = true`. */
  readonly companyIds: readonly string[];
  /** Every user holding a membership in one of those companies. */
  readonly userIds: readonly string[];
};

export const EMPTY_SANDBOX_REALM: SandboxRealm = {
  companyIds: [],
  userIds: [],
};

/** The tenant table itself, which carries the flag rather than a reference. */
export const SANDBOX_FLAG_TABLE = "companies";

/**
 * How a row on each table the operator console reads is tied to a tenant.
 *
 * `nullable` is read from the live catalog on enisnjjbxqaliydepacc, not
 * guessed, because it changes the filter: `col=not.in.(...)` evaluates to
 * NULL for a null column and PostgREST drops the row, which would silently
 * remove anonymous feedback from the console rather than remove sandbox rows.
 *
 *   select a.attname, a.attnotnull from pg_attribute a
 *     join pg_class c on c.oid = a.attrelid
 *     join pg_namespace n on n.oid = c.relnamespace
 *    where n.nspname = 'public' and c.relname = <table>;
 */
export const SANDBOX_KEYED_TABLES: Readonly<
  Record<
    string,
    { column: string; scope: "company" | "user"; nullable: boolean }
  >
> = {
  companies: { column: "sandbox", scope: "company", nullable: false },
  company_members: { column: "company_id", scope: "company", nullable: false },
  invitations: { column: "company_id", scope: "company", nullable: false },
  profiles: { column: "id", scope: "user", nullable: false },
  subscriptions: { column: "user_id", scope: "user", nullable: false },
  tax_profiles: { column: "user_id", scope: "user", nullable: false },
  feedback: { column: "user_id", scope: "user", nullable: true },
  admin_actions: { column: "target_user_id", scope: "user", nullable: true },
};

/**
 * Tables the console reads that hold no tenant row, each with the reason.
 *
 * Section 6.5's closing rule, applied to a table rather than an egress path:
 * "If a row in this table names a path your product does not have, say so
 * explicitly rather than leaving the row blank." A table absent from both
 * maps is refused at runtime, so this list is an assertion rather than a
 * convenience.
 */
export const TENANT_FREE_TABLES: Readonly<Record<string, string>> = {
  super_admins:
    "Keyed by email, one row per Techno Optics operator. Holds no customer " +
    "row and a provisioned prospect can never appear in it.",
  firms:
    "An accounting firm, not a tenant. The tenant flag lives on companies; " +
    "provisioning creates a company, never a firm.",
  firm_access_requests:
    "A firm asking to be onboarded, submitted before any company exists. " +
    "Carries no company reference at all.",
  firm_invitations:
    "Keyed by firm_id, an invitation for a preparer to join a firm. Carries " +
    "no company reference.",
  security_pulse_runs:
    "Internal security scan results for the operator console. Keyed by the " +
    "operator who ran it, with no customer row in it.",
};

/** Maximum characters an id list may take in the URL before we refuse. */
const MAX_ID_LIST_CHARS = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The table a PostgREST URL addresses, or null if the URL is not PostgREST.
 * An rpc keeps its `rpc/` prefix so it cannot be mistaken for a table.
 */
export function restTableFromUrl(url: URL): string | null {
  const match = url.pathname.match(/\/rest\/v1\/(.+)$/);
  if (!match) return null;
  const path = match[1].split("?")[0];
  return path.length > 0 ? path : null;
}

/**
 * An rpc runs its body as the service role, so there is no filter to add to
 * it and no way to bind it here. It is refused rather than passed.
 */
function refuseRpc(table: string): void {
  if (!table.startsWith("rpc/")) return;
  throw new Error(
    `hq: refusing the elevated rpc "${table}". A function body runs as the ` +
      `service role, so the sandbox boundary cannot be applied to it and ` +
      `there is no filter to add. Read the tables directly, or bind the ` +
      `function to a tenant and record it in docs/design/fleet-integration.md.`,
  );
}

/**
 * Narrow a read so it cannot return a sandbox tenant's rows. Mutates `url`.
 *
 * Throws rather than passing anything through it cannot account for. The
 * caller is the operator console, so the cost of throwing is one broken
 * internal page and the cost of passing is a sandbox row in a report a real
 * person reads, which is 6.7 failure mode 2.
 */
export function applySandboxExclusion(url: URL, realm: SandboxRealm): void {
  const table = restTableFromUrl(url);
  if (table === null) return;

  refuseRpc(table);

  // Classification is checked before the empty-realm shortcut on purpose.
  // Otherwise the partition would be dormant until the first sandbox tenant
  // existed, and would first be exercised on the day it matters.
  const key = SANDBOX_KEYED_TABLES[table];
  if (!key) {
    if (table in TENANT_FREE_TABLES) return;
    throw new Error(
      `hq: table "${table}" is not classified for the sandbox boundary. ` +
        `Section 6.3 requires every elevated read to be bound to a tenant or ` +
        `stated plainly as unbound. Add it to SANDBOX_KEYED_TABLES with the ` +
        `column that ties a row to a tenant, or to TENANT_FREE_TABLES with ` +
        `the reason it holds no tenant row.`,
    );
  }

  if (realm.companyIds.length === 0) return;

  if (table === SANDBOX_FLAG_TABLE) {
    // `is.false` rather than `not.is.true`: the column is `not null default
    // false`, so the two agree today, and `is.false` is the one that also
    // excludes a row should the column ever become nullable.
    url.searchParams.append(key.column, "is.false");
    return;
  }

  const ids = key.scope === "company" ? realm.companyIds : realm.userIds;
  if (ids.length === 0) return;

  const list = idList(ids);
  if (key.nullable) {
    if (url.searchParams.has("or")) {
      throw new Error(
        `hq: "${table}" already carries an or= filter, and the sandbox ` +
          `exclusion for a nullable key needs one of its own. PostgREST is ` +
          `believed to AND repeated params, which is not measured on this ` +
          `deployment, so this refuses rather than relies on it. Restructure ` +
          `the query, or filter it on a non-nullable key.`,
      );
    }
    url.searchParams.append(
      "or",
      `(${key.column}.is.null,${key.column}.not.in.${list})`,
    );
    return;
  }
  url.searchParams.append(key.column, `not.in.${list}`);
}

function idList(ids: readonly string[]): string {
  for (const id of ids) {
    if (!UUID.test(id)) {
      throw new Error(
        `hq: refusing to build a sandbox exclusion from "${id}", which is not ` +
          `a uuid. Nothing unvalidated is interpolated into a PostgREST filter.`,
      );
    }
  }
  const list = `(${ids.map((id) => `"${id}"`).join(",")})`;
  if (list.length > MAX_ID_LIST_CHARS) {
    throw new Error(
      `hq: too many sandbox tenants to exclude by id list (${ids.length}). ` +
        `The filter would be ${list.length} characters and PostgREST requests ` +
        `have a URL length limit, so a longer list would start failing reads ` +
        `at an unpredictable point. Move the exclusion into the database ` +
        `before provisioning this many sandbox tenants.`,
    );
  }
  return list;
}

type RealmRow = Record<string, unknown>;
type RealmResult = PromiseLike<{
  data: RealmRow[] | null;
  error: { message: string } | null;
}>;

/** The two reads `loadSandboxRealm` needs, and nothing else. */
export type SandboxRealmSource = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: boolean): RealmResult;
      in(column: string, values: readonly string[]): RealmResult;
    };
  };
};

/**
 * Read which tenants are sandboxes, and who is inside them.
 *
 * This is the one elevated read that must NOT be bound, because it is the
 * thing that does the binding. It runs on a plain service-role client for
 * that reason, and is the only such read in the console's request path.
 *
 * It throws on failure rather than returning an empty realm. An empty realm
 * reads as "no sandbox tenant exists" and would let every console read run
 * unbound, which is the failure this module exists to prevent.
 */
export async function loadSandboxRealm(
  db: SandboxRealmSource,
): Promise<SandboxRealm> {
  const companies = await db
    .from("companies")
    .select("id")
    .eq(SANDBOX_KEYED_TABLES.companies.column, true);
  if (companies.error) {
    throw new Error(
      `reading the sandbox tenants failed: ${companies.error.message}`,
    );
  }
  const companyIds = (companies.data ?? []).map((row) => String(row.id));
  if (companyIds.length === 0) return EMPTY_SANDBOX_REALM;

  const members = await db
    .from("company_members")
    .select("user_id")
    .in("company_id", companyIds);
  if (members.error) {
    throw new Error(
      `reading the sandbox tenants' members failed: ${members.error.message}`,
    );
  }
  const userIds = [
    ...new Set((members.data ?? []).map((row) => String(row.user_id))),
  ];
  return { companyIds, userIds };
}

/**
 * Wrap a `fetch` so every PostgREST read it carries excludes sandbox tenants.
 *
 * The realm lookup is memoised for the lifetime of the wrapper, which is the
 * lifetime of one client, which in this application is one server render. The
 * answer cannot change inside a render, and a console page issues nine reads
 * in one `Promise.all`.
 */
export function sandboxExcludingFetch(
  loadRealm: () => Promise<SandboxRealm>,
  underlying: typeof fetch = fetch,
): typeof fetch {
  let pending: Promise<SandboxRealm> | null = null;
  const realm = () => (pending ??= loadRealm());

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
    const url = new URL(href);
    const table = restTableFromUrl(url);
    if (table === null) return underlying(input, init);

    // The rpc refusal comes BEFORE the method gate. postgrest-js sends
    // `rpc(fn, args)` as a POST unless the caller asks for GET or HEAD, so a
    // refusal reached only from the read branch would never fire for the
    // ordinary call and the control would read as present while doing nothing.
    refuseRpc(table);

    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") return underlying(input, init);

    let resolved: SandboxRealm;
    try {
      resolved = await realm();
    } catch (cause) {
      throw new Error(
        `hq: cannot determine the sandbox realm, so this elevated read is ` +
          `refused rather than run unbound. ${(cause as Error).message}`,
        { cause },
      );
    }
    applySandboxExclusion(url, resolved);
    return underlying(url.href, init);
  };
}
