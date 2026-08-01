import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who a mileage view is allowed to read, and the queries that enforce it.
 *
 * ## Why this lives in lib/ and not inline in the page
 *
 * RLS is NOT the barrier here. The `mileage_trips manager + firm read`
 * policy (supabase/migrations/20260514000016_mileage_tracker.sql) grants a
 * company manager `select` on EVERY trip in their company, and
 * `mileage_points follow trip visibility` grants them the matching GPS
 * breadcrumbs. So the filters below are the only thing standing between an
 * admin and a colleague's private movements. That deserves to be a unit
 * under test rather than a couple of chained calls buried in a server
 * component. See team-scope.test.ts.
 *
 * ## The rule
 *
 * - Your OWN drives: everything. It is your data, and this page is where
 *   you triage your own unclassified drives.
 * - Anyone ELSE's drives: `classification = 'business'` AND the drive was
 *   not merely ASSUMED to be business.
 *
 * `needs_confirmation = true` means the classifier had no evidence and fell
 * back to a blanket "business" default (migration
 * 20260801000000_mileage_needs_confirmation.sql). Those rows are stored with
 * deduction_cents = 0 precisely because the product does not trust the
 * label. A drive we will not count as a deduction is not a drive we should
 * show to a colleague: it may well be a personal trip that simply has not
 * been corrected yet. Most production companies have saved no
 * mileage_places at all, so for them the heuristic can never fire and EVERY
 * auto-classified drive takes the blanket default, and without this filter the
 * "business only" promise would be close to meaningless.
 */

/** `?driver=all`: the whole-team overlay. */
export const ALL_DRIVERS = "all";

export type TripScope =
  /** The viewer's own drives, unrestricted. */
  | { kind: "self"; driverUserId: string }
  /** One named teammate, restricted to confirmed business drives. */
  | { kind: "other"; driverUserId: string }
  /** Everyone: the viewer unrestricted + every teammate restricted. */
  | { kind: "team"; viewerUserId: string };

/**
 * Decide what a request is allowed to see.
 *
 * Since August 2026 a manager of a 2+ person team lands on the TEAM view by
 * default (the owner's ask: "by default, for the company admin, show every
 * user's drives"). `?driver=<their own id>` pins the page back to just them.
 *
 * Every path that is not explicitly authorized collapses to `self`, so a
 * non-manager cannot reach another driver's data by hand-editing the query
 * string, and neither can a manager naming someone outside their company.
 */
export function resolveTripScope({
  isManager,
  viewerUserId,
  driverParam,
  driverIds,
}: {
  isManager: boolean;
  viewerUserId: string;
  /** Raw `?driver=` value. */
  driverParam: string;
  /** Every member of the viewer's company, including the viewer. */
  driverIds: readonly string[];
}): TripScope {
  const self: TripScope = { kind: "self", driverUserId: viewerUserId };
  if (!isManager) return self;

  const teamSize = new Set(driverIds).size;
  const param = driverParam.trim();

  if (param === viewerUserId) return self;
  // No param at all is the new default, and it means "the whole team".
  if (param === "" || param === ALL_DRIVERS)
    return teamSize >= 2 ? { kind: "team", viewerUserId } : self;
  if (driverIds.includes(param)) return { kind: "other", driverUserId: param };
  return self;
}

export const TRIP_SELECT =
  "id, driver_user_id, started_at, ended_at, distance_miles, classification, tax_year, deduction_cents, needs_confirmation, notes";

type TripQueryInput = {
  companyId: string;
  scope: TripScope;
  sinceIso: string;
  limit?: number;
};

/** The viewer's own drives. No classification filter, by design. */
function selfQuery(
  admin: SupabaseClient,
  companyId: string,
  driverUserId: string,
  sinceIso: string,
  limit: number,
) {
  return admin
    .from("mileage_trips")
    .select(TRIP_SELECT)
    .eq("company_id", companyId)
    .eq("driver_user_id", driverUserId)
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })
    .limit(limit);
}

/**
 * Someone else's drives. THIS IS THE PRIVACY FILTER. Every restriction is
 * applied in the query, so a personal or merely-assumed drive is never
 * fetched, never serialized to the client, and never contributes a trip id
 * to the polyline lookup that draws the routes.
 *
 * `.eq("company_id", companyId)` compiles to `NOT (col IS TRUE)`,
 * which keeps FALSE and NULL. Do not "simplify" it to
 * `.neq("needs_confirmation", true)`: that is NULL-unsafe and would hide
 * every drive recorded before the column existed.
 */
function othersQuery(
  admin: SupabaseClient,
  companyId: string,
  target: { only: string } | { except: string },
  sinceIso: string,
  limit: number,
) {
  const base = admin
    .from("mileage_trips")
    .select(TRIP_SELECT)
    .eq("company_id", companyId);
  const scoped =
    "only" in target
      ? base.eq("driver_user_id", target.only)
      : base.neq("driver_user_id", target.except);
  return scoped
    .eq("classification", "business")
    .not("needs_confirmation", "is", true)
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })
    .limit(limit);
}

/**
 * Run the queries for a scope and return the rows the viewer may see.
 *
 * The team scope is two scoped queries rather than one `or(...)`: keeping
 * "mine" and "theirs" as separate statements means the business-only
 * restriction cannot accidentally be widened by an operator-precedence
 * mistake inside a compound filter.
 */
export async function loadScopedTrips<T>(
  admin: SupabaseClient,
  { companyId, scope, sinceIso, limit = 500 }: TripQueryInput,
): Promise<T[]> {
  if (scope.kind === "self") {
    const { data } = await selfQuery(
      admin,
      companyId,
      scope.driverUserId,
      sinceIso,
      limit,
    );
    return (data ?? []) as unknown as T[];
  }
  if (scope.kind === "other") {
    const { data } = await othersQuery(
      admin,
      companyId,
      { only: scope.driverUserId },
      sinceIso,
      limit,
    );
    return (data ?? []) as unknown as T[];
  }
  const [own, others] = await Promise.all([
    selfQuery(admin, companyId, scope.viewerUserId, sinceIso, limit),
    othersQuery(
      admin,
      companyId,
      { except: scope.viewerUserId },
      sinceIso,
      limit,
    ),
  ]);
  return [
    ...((own.data ?? []) as unknown as T[]),
    ...((others.data ?? []) as unknown as T[]),
  ];
}

type PrivacyShapedRow = {
  driver_user_id?: string | null;
  classification?: string | null;
  needs_confirmation?: boolean | null;
};

/**
 * Belt-and-braces, in the same spirit as the explicit `.eq("user_id", uid)`
 * in getMyCompanies(): re-apply the rule in memory before anything renders.
 *
 * The queries above are the real enforcement. This exists so that a future
 * edit which adds a third query, widens a filter, or reorders the chain
 * still cannot put a colleague's private drive on screen. And because the
 * polyline lookup is keyed off the surviving rows, cannot put their route on
 * the map either. A row with no driver is treated as foreign, never as the
 * viewer's.
 */
export function stripForeignPrivateTrips<T extends PrivacyShapedRow>(
  rows: T[],
  viewerUserId: string,
): T[] {
  return rows.filter((r) => {
    if (r.driver_user_id && r.driver_user_id === viewerUserId) return true;
    return r.classification === "business" && r.needs_confirmation !== true;
  });
}
