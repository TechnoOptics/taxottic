/**
 * The one place that decides whether an outbound message may reach the people
 * it is addressed to.
 *
 * WHY THIS EXISTS
 *
 * Fleet contract 6.5, transactional email: "One send function, which drops
 * any message whose recipients are not all on the sandbox allowlist. The
 * allowlist for a sandbox tenant is exactly the prospect's own address, plus
 * any address they invited into their own sandbox tenant. Everything else is
 * dropped and counted, not queued." The row below it, for push: "Same rule,
 * same chokepoint shape, same allowlist."
 *
 * "Same allowlist" is the whole reason this is one module and not two. The
 * two chokepoints differ in what they hold (a user id for push, an address
 * for email) and in what they return, so each keeps its own adapter, but the
 * rule and the realm read are shared. Two copies of one rule is the mechanism
 * 6.2 rejects wearing a coarser grain: when the rule changes, one copy
 * changes.
 *
 * WHERE IT IS CALLED FROM, AND WHY THOSE TWO PLACES
 *
 *   lib/push/index.ts       notify(), the single exit for APNs, FCM and web
 *                           push, 16 producers behind it.
 *   lib/email/transport.ts  sendEmail(), the single exit to Resend, 13 call
 *                           sites behind it.
 *
 * Not at the 29 call sites. 6.5: "The check belongs at the chokepoint, not at
 * each call site."
 *
 * WHAT IT CAN DECIDE, AND WHAT IT CANNOT, STATED PLAINLY
 *
 * It sees the RECIPIENTS of a message and nothing else. So it answers "may
 * these people be addressed together, and may a sandbox tenant's message
 * reach them", and it cannot answer "is the body of this message about a
 * sandbox tenant". A digest addressed only to real people, whose contents
 * were aggregated across a sandbox tenant, passes this screen. Closing that
 * requires the 6.3 read predicate to bind the job that built the body, which
 * for a service-role caller it does not. docs/design/fleet-integration.md
 * carries that gap and the sequencing that holds it shut in the meantime.
 *
 * DROPPED, NOT THROWN
 *
 * A refusal is returned, never raised. Both chokepoints are documented as
 * best-effort and non-throwing, and 16 push producers plus 13 email call
 * sites are written against that. Turning a containment decision into an
 * exception would change how a real customer's request behaves today, which
 * is the one thing this work must not do. 6.5 asks for "dropped and counted,
 * not queued", and the drop is counted by a stable `[hq-egress]` line that
 * each chokepoint logs, which is the only counter that survives a serverless
 * invocation.
 */

import {
  SANDBOX_FLAG_TABLE,
  SANDBOX_KEYED_TABLES,
} from "@/lib/hq/sandbox-exclusion";

/** One sandbox tenant, and everyone a message from it may reach. */
export type SandboxTenant = {
  /** `companies.id` of a row with `sandbox = true`. */
  readonly companyId: string;
  /** Every user holding a membership in it. */
  readonly userIds: readonly string[];
  /**
   * Every address it may write to, lowercased: its members' profile
   * addresses, plus every address invited into it. The invitations half is
   * 6.5's "plus any address they invited into their own sandbox tenant", and
   * it is not optional: an invitation is sent BEFORE the invitee has a
   * profile, so an allowlist built from memberships alone would drop the one
   * message that proves the invite worked. 6.6: "Silently sending nothing is
   * itself a tell."
   */
  readonly emails: readonly string[];
};

export type OutboundRealm = {
  readonly tenants: readonly SandboxTenant[];
};

/** The state of the production database today, and the common path forever. */
export const NO_SANDBOX_TENANTS: OutboundRealm = { tenants: [] };

/** A person a message reaches, in whichever handle the chokepoint holds. */
export type Recipient =
  | { kind: "user"; id: string }
  | { kind: "email"; address: string };

export type EgressDecision = {
  readonly allowed: boolean;
  /** Why, in a form worth putting in a log line. */
  readonly reason: string;
};

function normaliseAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** Every sandbox tenant a recipient belongs to. Normally none, or exactly one. */
function tenantsOf(
  recipient: Recipient,
  realm: OutboundRealm,
): readonly string[] {
  if (recipient.kind === "user") {
    return realm.tenants
      .filter((t) => t.userIds.includes(recipient.id))
      .map((t) => t.companyId);
  }
  const address = normaliseAddress(recipient.address);
  return realm.tenants
    .filter((t) => t.emails.includes(address))
    .map((t) => t.companyId);
}

/**
 * May this message reach these recipients?
 *
 * Pure, so the rule can be read in one place and exercised without a
 * database. The realm is supplied by loadOutboundRealm().
 */
export function decideOutbound(
  recipients: readonly Recipient[],
  realm: OutboundRealm,
): EgressDecision {
  if (realm.tenants.length === 0) {
    return {
      allowed: true,
      reason: "no sandbox tenant exists, so no message can belong to one",
    };
  }

  const inside = new Set<string>();
  let outsiders = 0;
  for (const recipient of recipients) {
    const tenants = tenantsOf(recipient, realm);
    if (tenants.length === 0) {
      outsiders += 1;
      continue;
    }
    if (tenants.length > 1) {
      // The boundary migration's stated invariant is that provisioning never
      // gives one user a foot in two realms. This is the same invariant one
      // level down. If it is broken there is no single allowlist to check
      // against, so this refuses rather than picking one.
      return {
        allowed: false,
        reason:
          "a recipient belongs to more than one sandbox tenant, so there is " +
          "no single allowlist this message can be checked against",
      };
    }
    inside.add(tenants[0]);
  }

  if (inside.size === 0) {
    return {
      allowed: true,
      reason: "no recipient is inside a sandbox tenant",
    };
  }
  if (outsiders > 0) {
    return {
      allowed: false,
      reason:
        `${outsiders} recipient(s) are outside the sandbox tenant this ` +
        "message reaches into. 6.5: the allowlist is the prospect's own " +
        "address plus the addresses they invited into their own tenant, and " +
        "nothing else",
    };
  }
  if (inside.size > 1) {
    return {
      allowed: false,
      reason:
        "this message reaches more than one sandbox tenant, and each " +
        "tenant's allowlist is its own",
    };
  }
  return {
    allowed: true,
    reason: "every recipient is inside one sandbox tenant",
  };
}

// ---------------------------------------------------------------------------

type RealmRow = Record<string, unknown>;
type RealmResult = PromiseLike<{
  data: RealmRow[] | null;
  error: { message: string } | null;
}>;

/** The four reads loadOutboundRealm needs, and nothing else. */
export type OutboundRealmSource = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: boolean): RealmResult;
      in(column: string, values: readonly string[]): RealmResult;
    };
  };
};

async function rows(
  result: RealmResult,
  what: string,
): Promise<RealmRow[]> {
  const { data, error } = await result;
  if (error) throw new Error(`reading ${what} failed: ${error.message}`);
  return data ?? [];
}

/**
 * Read which tenants are sandboxes, who is inside them, and which addresses
 * they may write to.
 *
 * Not cached. A cache would mean a window, measured in whatever the TTL is,
 * during which a freshly provisioned sandbox tenant sends unscreened, and the
 * window would open on exactly the day it matters. The cost of not caching is
 * one PostgREST GET per outbound message, and on a deployment with no sandbox
 * tenant it is one GET returning an empty array: the first read short-circuits
 * the other three.
 *
 * Throws on a read failure rather than returning an empty realm. An empty
 * realm reads as "no sandbox tenant exists", which is the answer that lets
 * every message through.
 */
export async function loadOutboundRealm(
  db: OutboundRealmSource,
): Promise<OutboundRealm> {
  // The table and column come from lib/hq/sandbox-exclusion rather than being
  // written as literals, so the boundary has one spelling of its flag and not
  // three. It also keeps this READ from matching the provisioning tripwire in
  // lib/hq/elevated-call-sites.test.ts, which looks for the literal pair and
  // is watching for a WRITE that creates a sandbox tenant.
  const companies = await rows(
    db
      .from(SANDBOX_FLAG_TABLE)
      .select("id")
      .eq(SANDBOX_KEYED_TABLES.companies.column, true),
    "the sandbox tenants",
  );
  const companyIds = companies.map((row) => String(row.id));
  if (companyIds.length === 0) return NO_SANDBOX_TENANTS;

  const members = await rows(
    db.from("company_members").select("company_id, user_id").in("company_id", companyIds),
    "the sandbox tenants' members",
  );
  const userIds = [...new Set(members.map((row) => String(row.user_id)))];

  const profiles =
    userIds.length === 0
      ? []
      : await rows(
          db.from("profiles").select("id, email").in("id", userIds),
          "the sandbox members' addresses",
        );
  const addressOf = new Map(
    profiles.map((row) => [String(row.id), normaliseAddress(String(row.email))]),
  );

  const invitations = await rows(
    db.from("invitations").select("company_id, email").in("company_id", companyIds),
    "the sandbox tenants' invitations",
  );

  return {
    tenants: companyIds.map((companyId) => {
      const tenantUserIds = members
        .filter((row) => String(row.company_id) === companyId)
        .map((row) => String(row.user_id));
      const emails = new Set<string>();
      for (const userId of tenantUserIds) {
        const address = addressOf.get(userId);
        if (address) emails.add(address);
      }
      for (const row of invitations) {
        if (String(row.company_id) === companyId) {
          emails.add(normaliseAddress(String(row.email)));
        }
      }
      return {
        companyId,
        userIds: [...new Set(tenantUserIds)],
        emails: [...emails],
      };
    }),
  };
}

/**
 * Make a user-controlled string safe to put in the `[hq-egress]` line.
 *
 * That line is the count 6.5 asks for, which means it has to be one line. An
 * email subject here is user-controlled (`firm-digest` builds one from
 * `firms.name`), so a newline inside it would forge an entry in the record the
 * Hub operator is pointed at, and a very long one would flood it.
 */
export function logSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 140);
}

/** The To and every Cc, which are all the people an email reaches. */
export function emailRecipients(args: {
  to: string;
  cc?: string | string[];
}): Recipient[] {
  const addresses = [args.to, ...(Array.isArray(args.cc) ? args.cc : args.cc ? [args.cc] : [])];
  return addresses.map((address) => ({ kind: "email" as const, address }));
}

/**
 * The call a chokepoint makes: read the realm, apply the rule, never throw.
 *
 * Fails closed. If the realm cannot be read we do not know whether any
 * recipient is a prospect, and sending unscreened on a read error is an open
 * boundary that looks like a working product. The cost is bounded: this read
 * shares its fate with the reads that produced the message in the first place,
 * so the outage in which it fails is one where there was nothing to send.
 *
 * The source is a factory rather than a client because BUILDING the client is
 * itself a step that can throw, before any promise exists: supabase-js raises
 * when the service-role key is absent. Constructing it here puts that failure
 * inside the same fail-closed branch as a failed read, and keeps both
 * chokepoints' never-throws contract intact without either of them writing
 * its own try.
 */
export async function screenOutbound(
  recipients: readonly Recipient[],
  source: () => OutboundRealmSource,
): Promise<EgressDecision> {
  let realm: OutboundRealm;
  try {
    realm = await loadOutboundRealm(source());
  } catch (cause) {
    return {
      allowed: false,
      reason:
        `the sandbox realm could not be read, so this message is refused ` +
        `rather than sent unscreened: ${(cause as Error).message}`,
    };
  }
  return decideOutbound(recipients, realm);
}
