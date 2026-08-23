/**
 * The operator console's database client, with the fleet sandbox boundary on
 * it.
 *
 * Fleet contract 6.7, failure mode 2, "the admin report that counts all rows":
 * "An internal dashboard, an investor metric, `report_counts` itself, or a
 * churn report counts sandbox rows as customers." Section 7 says the same
 * thing about the counts themselves: "These counts must exclude every
 * sandbox."
 *
 * `service_role` carries `BYPASSRLS`, so the `hq_sandbox_barrier` policy the
 * boundary migration installs does not run for a client built with it. This
 * factory returns a client whose `fetch` narrows every PostgREST read before
 * it leaves the process. The pages that use it contain no sandbox check of
 * their own and are not expected to grow one; the check is here, once.
 *
 * The realm lookup deliberately runs on a plain, unbound client: it is the
 * one read that has to see sandbox rows in order to exclude them everywhere
 * else. It is a normal read filtered on `companies.sandbox`, not a write, so
 * it does not create a sandbox tenant and does not trip the provisioning gate
 * in lib/hq/elevated-call-sites.test.ts. The column name is taken from
 * SANDBOX_KEYED_TABLES rather than written as a literal so that the boundary
 * has one spelling of it, not two.
 */

import {
  createServiceClient,
  createServiceClientWithFetch,
} from "@/lib/supabase/server";
import {
  loadSandboxRealm,
  sandboxExcludingFetch,
  type SandboxRealmSource,
} from "@/lib/hq/sandbox-exclusion";

/**
 * The one privileged client this file hands out, and the only kind of read it
 * is for: asking which tenants are sandboxes and who is inside them.
 *
 * It is deliberately NOT bound by the boundary, because it is the read that
 * DEFINES the boundary. A client narrowed to exclude sandbox rows cannot tell
 * you which rows those are.
 *
 * There are two call paths to it, and both are named in
 * lib/hq/elevated-call-sites.test.ts rather than left to a count:
 *
 *   createSandboxExcludingClient()   the operator console's realm lookup
 *   lib/email/transport.ts           the 6.5 outbound recipient allowlist
 *
 * Read that test before adding a third. Because this factory holds a single
 * `createServiceClient()` occurrence, a new caller moves no number in the
 * invocation ceiling, which is exactly the shape 6.3 warns about. The caller
 * list is pinned instead.
 */
export function createBoundaryReadClient() {
  return createServiceClient();
}

export function createSandboxExcludingClient() {
  const raw = createBoundaryReadClient();
  return createServiceClientWithFetch(
    sandboxExcludingFetch(() =>
      loadSandboxRealm(raw as unknown as SandboxRealmSource),
    ),
  );
}
