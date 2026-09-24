/**
 * The sandbox exclusion, tested as a pure URL rewrite.
 *
 * Fleet contract 6.5: "The check belongs at the chokepoint, not at each call
 * site." 6.7 failure mode 2: "the admin report that counts all rows". Section
 * 7: `report_counts` and every internal count must exclude every sandbox
 * tenant and every user inside one.
 *
 * The chokepoint is the `fetch` a service-role Supabase client is built with,
 * so every read that client issues is rewritten on the way out whether or not
 * the page that issued it knows this section exists. This file tests the
 * rewrite; `lib/hq/elevated-call-sites.test.ts` tests that the admin console
 * cannot get a client without it.
 */

import { describe, it, expect } from "vitest";
import {
  EMPTY_SANDBOX_REALM,
  SANDBOX_KEYED_TABLES,
  TENANT_FREE_TABLES,
  applySandboxExclusion,
  loadSandboxRealm,
  restTableFromUrl,
  sandboxExcludingFetch,
  type SandboxRealm,
} from "./sandbox-exclusion";

const CO_A = "11111111-1111-4111-8111-111111111111";
const CO_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";

const REALM: SandboxRealm = {
  companyIds: [CO_A, CO_B],
  userIds: [USER_A],
};

const REST = "https://example.supabase.co/rest/v1";

function rewrite(path: string, realm: SandboxRealm = REALM): URL {
  const url = new URL(`${REST}/${path}`);
  applySandboxExclusion(url, realm);
  return url;
}

describe("restTableFromUrl", () => {
  it("names the table a PostgREST path addresses", () => {
    expect(restTableFromUrl(new URL(`${REST}/companies?select=id`))).toBe(
      "companies",
    );
  });

  it("returns null for a path that is not PostgREST, so auth passes through", () => {
    expect(
      restTableFromUrl(
        new URL("https://example.supabase.co/auth/v1/admin/users/abc"),
      ),
    ).toBeNull();
  });

  it("keeps the rpc prefix, so an rpc is not mistaken for a table", () => {
    expect(restTableFromUrl(new URL(`${REST}/rpc/company_summary`))).toBe(
      "rpc/company_summary",
    );
  });
});

describe("the exclusion the chokepoint applies", () => {
  it("filters the tenant table on its own flag", () => {
    expect(
      rewrite("companies?select=id,name").searchParams.get("sandbox"),
    ).toBe("is.false");
  });

  it("filters a company-keyed table on the sandbox company ids", () => {
    expect(
      rewrite("company_members?select=user_id").searchParams.get("company_id"),
    ).toBe(`not.in.("${CO_A}","${CO_B}")`);
  });

  it("filters a user-keyed table on the sandbox user ids", () => {
    expect(
      rewrite("subscriptions?select=plan").searchParams.get("user_id"),
    ).toBe(`not.in.("${USER_A}")`);
  });

  it("keys profiles on its own primary key, which is the auth user id", () => {
    expect(rewrite("profiles?select=email").searchParams.get("id")).toBe(
      `not.in.("${USER_A}")`,
    );
  });

  it("keeps rows whose nullable key is null, which are nobody's tenant rows", () => {
    // `user_id=not.in.(...)` evaluates to NULL for a null user_id, so PostgREST
    // would drop anonymous feedback from the admin console. That is a
    // regression, not an exclusion.
    expect(rewrite("feedback?select=body").searchParams.get("or")).toBe(
      `(user_id.is.null,user_id.not.in.("${USER_A}"))`,
    );
  });

  it("leaves the caller's own filters in place", () => {
    const url = rewrite("company_members?select=role&company_id=eq.abc");
    expect(url.searchParams.getAll("company_id")).toEqual([
      "eq.abc",
      `not.in.("${CO_A}","${CO_B}")`,
    ]);
  });

  it("adds nothing to a table that holds no tenant data", () => {
    const url = rewrite("super_admins?select=email");
    expect([...url.searchParams.keys()]).toEqual(["select"]);
  });

  it("adds nothing when no sandbox tenant exists", () => {
    const url = rewrite("company_members?select=user_id", EMPTY_SANDBOX_REALM);
    expect([...url.searchParams.keys()]).toEqual(["select"]);
  });

  it("adds no user filter when the sandbox tenants hold no users yet", () => {
    const url = rewrite("subscriptions?select=plan", {
      companyIds: [CO_A],
      userIds: [],
    });
    expect([...url.searchParams.keys()]).toEqual(["select"]);
  });
});

describe("the chokepoint fails closed rather than guessing", () => {
  it("refuses a table it has not classified, even with no sandbox tenant", () => {
    // Checked before the empty-realm shortcut on purpose: the partition is
    // enforced today, so a new admin read of an unclassified table fails now
    // rather than the day a sandbox tenant is first provisioned.
    expect(() =>
      rewrite("mileage_trips?select=id", EMPTY_SANDBOX_REALM),
    ).toThrow(/not classified/i);
  });

  it("refuses an rpc, which runs as the service role with no filter to add", () => {
    expect(() => rewrite("rpc/anything")).toThrow(/rpc/i);
  });

  it("refuses an id that is not a uuid, so nothing is interpolated blind", () => {
    expect(() =>
      rewrite("company_members?select=id", {
        companyIds: ['x","y'],
        userIds: [],
      }),
    ).toThrow(/uuid/i);
  });

  it("refuses to emit a second or= param rather than assume it would AND", () => {
    // PostgREST ANDs repeated query params. That is believed, not measured on
    // this deployment, and a wrong belief here silently widens a read. The
    // only nullable-keyed tables are small admin surfaces, so refusing costs
    // nothing and assumes nothing.
    const url = new URL(`${REST}/feedback?select=body&or=(a.eq.1,b.eq.2)`);
    expect(() => applySandboxExclusion(url, REALM)).toThrow(/or=/);
  });

  it("refuses a sandbox id list too long to survive the URL length limit", () => {
    const many = Array.from(
      { length: 400 },
      (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
    );
    expect(() =>
      rewrite("company_members?select=id", { companyIds: many, userIds: [] }),
    ).toThrow(/too many sandbox tenants/i);
  });
});

describe("the fetch wrapper, which is where the chokepoint actually sits", () => {
  function capturing(realm: SandboxRealm | Error) {
    const seen: { url: string; method: string }[] = [];
    const underlying = (async (input: string, init?: RequestInit) => {
      seen.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;
    let loads = 0;
    const load = async () => {
      loads += 1;
      if (realm instanceof Error) throw realm;
      return realm;
    };
    return {
      seen,
      loads: () => loads,
      fetch: sandboxExcludingFetch(load, underlying),
    };
  }

  it("rewrites a read the caller never knew was being rewritten", async () => {
    const c = capturing(REALM);
    await c.fetch(`${REST}/companies?select=id`);
    expect(new URL(c.seen[0].url).searchParams.get("sandbox")).toBe("is.false");
  });

  it("rewrites a head-only count, which is how the console counts rows", async () => {
    // `select("id", { count: "exact", head: true })` issues HEAD. Section 7's
    // counts are exactly these, so a wrapper that only handled GET would leave
    // every count in the console including sandbox rows.
    const c = capturing(REALM);
    await c.fetch(`${REST}/profiles?select=id`, { method: "HEAD" });
    expect(new URL(c.seen[0].url).searchParams.get("id")).toBe(
      `not.in.("${USER_A}")`,
    );
  });

  it("looks the realm up once per client, not once per query", async () => {
    // A console page issues nine reads in one `Promise.all`. Nine extra
    // lookups per render would be a visible cost for an answer that cannot
    // change inside one render.
    const c = capturing(REALM);
    await Promise.all([
      c.fetch(`${REST}/companies?select=id`),
      c.fetch(`${REST}/profiles?select=id`),
    ]);
    expect(c.loads()).toBe(1);
  });

  it("leaves a write alone, because a filter on a write means something else", async () => {
    const c = capturing(REALM);
    await c.fetch(`${REST}/company_members?id=eq.1`, { method: "PATCH" });
    expect(c.seen[0].url).toBe(`${REST}/company_members?id=eq.1`);
    expect(c.loads()).toBe(0);
  });

  it("refuses an rpc sent as a POST, which is how .rpc() sends by default", async () => {
    // postgrest-js `rpc(fn, args)` defaults to POST and only uses GET or HEAD
    // when the caller asks for them. A refusal reached only from the read
    // branch would never fire for the ordinary call, so the rpc check has to
    // sit ahead of the method gate rather than behind it.
    const c = capturing(REALM);
    await expect(
      c.fetch(`${REST}/rpc/company_summary`, { method: "POST", body: "{}" }),
    ).rejects.toThrow(/rpc/i);
    expect(c.seen).toEqual([]);
  });

  it("passes an auth call straight through", async () => {
    const c = capturing(REALM);
    await c.fetch("https://example.supabase.co/auth/v1/admin/users/abc", {
      method: "DELETE",
    });
    expect(c.seen[0].url).toBe(
      "https://example.supabase.co/auth/v1/admin/users/abc",
    );
  });

  it("fails the read when it cannot tell which tenants are sandboxes", async () => {
    const c = capturing(new Error("network down"));
    await expect(c.fetch(`${REST}/companies?select=id`)).rejects.toThrow(
      /sandbox realm/i,
    );
    expect(c.seen).toEqual([]);
  });
});

describe("the table partition is total, which is what makes failing closed safe", () => {
  it("classifies no table both ways", () => {
    const both = Object.keys(SANDBOX_KEYED_TABLES).filter(
      (t) => t in TENANT_FREE_TABLES,
    );
    expect(both).toEqual([]);
  });

  it("gives every tenant-free table a written reason", () => {
    for (const [table, reason] of Object.entries(TENANT_FREE_TABLES)) {
      expect(reason.length, `${table} has no reason`).toBeGreaterThan(20);
    }
  });
});

describe("reading the realm, which is the one query that must see sandbox rows", () => {
  /** The two calls loadSandboxRealm makes, as a stand-in for a query builder. */
  function db(
    responses: Record<string, { data?: unknown[]; error?: unknown }>,
  ) {
    const asked: string[] = [];
    const client = {
      from(table: string) {
        asked.push(table);
        const result = responses[table] ?? { data: [] };
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve(result).then(resolve),
        };
        return builder;
      },
    };
    return { client, asked };
  }

  it("does not go looking for members when no tenant is a sandbox", async () => {
    const { client, asked } = db({ companies: { data: [] } });
    expect(await loadSandboxRealm(client as never)).toEqual(
      EMPTY_SANDBOX_REALM,
    );
    expect(asked).toEqual(["companies"]);
  });

  it("counts every user holding a membership in a sandbox tenant, once", async () => {
    const { client } = db({
      companies: { data: [{ id: CO_A }, { id: CO_B }] },
      company_members: {
        data: [{ user_id: USER_A }, { user_id: USER_A }],
      },
    });
    expect(await loadSandboxRealm(client as never)).toEqual({
      companyIds: [CO_A, CO_B],
      userIds: [USER_A],
    });
  });

  it("throws rather than reporting an empty realm when the lookup errors", async () => {
    // Returning EMPTY here would read as "no sandbox tenants exist" and every
    // console read would run unbound, which is the failure this whole file
    // exists to prevent.
    const { client } = db({ companies: { error: { message: "boom" } } });
    await expect(loadSandboxRealm(client as never)).rejects.toThrow(/boom/);
  });
});
