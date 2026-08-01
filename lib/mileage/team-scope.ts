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

/** The subset of the PostgREST builder this filter needs, so the same
 *  function composes onto any mileage_trips query regardless of what has
 *  already been chained onto it. Deliberately NOT self-referential
 *  (`eq(): Q`): the builder's own type is recursive, and constraining a
 *  generic against it makes tsc give up with "type instantiation is
 *  excessively deep". The two casts in the body are the price of keeping
 *  the caller's exact builder type on the way out, so `.gte(...).limit(...)`
 *  still type-check after this. */
type Filterable = {
  eq(col: string, val: unknown): unknown;
  not(col: string, op: string, val: unknown): unknown;
};

/**
 * THIS IS THE PRIVACY FILTER, and it is a single function so that both
 * surfaces that show one person's drives to somebody else (the in-company
 * team view and the outside firm's map) are restricted by the same code.
 * Widening it in one place cannot silently leave the other narrow, and
 * narrowing it cannot silently leave the other wide.
 *
 * Apply it in the QUERY, never after the fetch: a personal or
 * merely-assumed drive must never be fetched, never serialized to the
 * client, and never contribute a trip id to the polyline lookup that draws
 * the routes.
 *
 * `.not("needs_confirmation", "is", true)` compiles to `NOT (col IS TRUE)`,
 * which keeps FALSE and NULL. Do not "simplify" it to
 * `.neq("needs_confirmation", true)`: that is NULL-unsafe and would hide
 * every drive recorded before the column existed.
 */
/** A mileage_trips query, reduced to just the chain the firm read needs.
 *  Small and self-referential on purpose: TS handles this fine, whereas
 *  generics resolved against the real builder hit TS2589. */
type TripQuery = Filterable & {
  eq(col: string, val: unknown): TripQuery;
  not(col: string, op: string, val: unknown): TripQuery;
  gte(col: string, val: string): TripQuery;
  order(col: string, opts: { ascending: boolean }): TripQuery;
  limit(n: number): PromiseLike<{ data: unknown[] | null }>;
};

export function restrictToSharedBusiness<Q extends Filterable>(query: Q): Q {
  const business = query.eq("classification", "business") as Filterable;
  return business.not("needs_confirmation", "is", true) as Q;
}

/** Someone else's drives, restricted by {@link restrictToSharedBusiness}. */
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
  return restrictToSharedBusiness(scoped)
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

/**
 * Every column the firm's map reads. `needs_confirmation` is selected even
 * though the query already filters on it, so that
 * {@link stripPrivateTrips} below can actually see the flag: an unselected
 * column arrives as `undefined`, which passes a `!== true` test and would
 * make the in-memory backstop a no-op.
 */
export const FIRM_TRIP_SELECT =
  "id, company_id, driver_user_id, started_at, distance_miles, classification, needs_confirmation, deduction_cents, notes, mileage_points(lat, lng, captured_at)";

/**
 * What an outside accounting firm may read across the companies it has an
 * active engagement with.
 *
 * A firm is a different actor from a company manager and gets strictly less:
 * a manager sees their OWN drives unrestricted because that is their own
 * data, whereas the firm is a counterparty outside the company and has no
 * drives of its own here. So there is no `self` branch, and
 * {@link restrictToSharedBusiness} applies to every row without exception.
 *
 * The stakes are higher than on the in-company view. This reads through the
 * service-role client, so RLS is not the barrier: the
 * `mileage_trips manager + firm read` policy
 * (supabase/migrations/20260514000016_mileage_tracker.sql) already grants a
 * firm select on EVERY trip of an engaged company via
 * `firm_has_active_engagement_with`, and `mileage_points follow trip
 * visibility` grants the matching GPS breadcrumbs. This function is the only
 * thing standing between an external accountant and an employee's private
 * movements, and the caller serialises the joined mileage_points straight
 * into the client payload.
 */
export async function loadFirmVisibleTrips<T>(
  admin: SupabaseClient,
  {
    companyIds,
    sinceIso,
    limit = 1000,
  }: { companyIds: readonly string[]; sinceIso: string; limit?: number },
): Promise<T[]> {
  if (companyIds.length === 0) return [];
  // Widened to the small self-referential shape above before the filter is
  // applied. Inferring the generic straight off the PostgREST builder makes
  // tsc bail with TS2589 on this chain, because `.select()` with an embedded
  // resource (`mileage_points(...)`) produces a very deep conditional type.
  const base = admin
    .from("mileage_trips")
    .select(FIRM_TRIP_SELECT)
    .in("company_id", companyIds as string[]) as unknown as TripQuery;
  const { data } = await restrictToSharedBusiness(base)
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })
    .limit(limit);
  return stripPrivateTrips((data ?? []) as unknown as (T &
    PrivacyShapedRow)[]);
}

type PrivacyShapedRow = {
  driver_user_id?: string | null;
  classification?: string | null;
  needs_confirmation?: boolean | null;
};

/**
 * The rule for showing one person's drive to somebody else: it is business,
 * and it was not merely ASSUMED to be business.
 */
function isSharedBusinessTrip(r: PrivacyShapedRow): boolean {
  return r.classification === "business" && r.needs_confirmation !== true;
}

/**
 * The firm's counterpart to {@link stripForeignPrivateTrips}: no `viewerUserId`
 * exemption, because to an outside firm every drive belongs to somebody else.
 */
export function stripPrivateTrips<T extends PrivacyShapedRow>(rows: T[]): T[] {
  return rows.filter(isSharedBusinessTrip);
}

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
    return isSharedBusinessTrip(r);
  });
}
