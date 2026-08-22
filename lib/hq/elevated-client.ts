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

export function createSandboxExcludingClient() {
  const raw = createServiceClient();
  return createServiceClientWithFetch(
    sandboxExcludingFetch(() =>
      loadSandboxRealm(raw as unknown as SandboxRealmSource),
    ),
  );
}
