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

/**
 * Every column a drive row renders with.
 *
 * `start_place_id` / `end_place_id` are here because the row NAMES its
 * endpoints, and a name is information, not decoration: mileage_trips
 * carries no lat or lng of its own, so without these two uuids a row can
 * say where it went only after its polyline has arrived over the network.
 * With them, a drive between two saved places is labelled on the first
 * paint, with no fetch at all. See components/mileage/TripList.tsx.
 */
export const TRIP_SELECT =
  "id, driver_user_id, started_at, ended_at, distance_miles, classification, tax_year, deduction_cents, needs_confirmation, notes, start_place_id, end_place_id";

type TripQueryInput = {
  companyId: string;
  scope: TripScope;
  sinceIso: string;
  /**
   * Optional upper bound for keyset pagination: only rows with
   * `started_at` at or before this instant are returned. Undefined means
   * no upper bound, i.e. the newest rows.
   *
   * Deliberately OPTIONAL and added on the end: the three other callers
   * of {@link loadScopedTrips} pass only `sinceIso` and keep compiling
   * and behaving exactly as before. Inclusive (`lte`, not `lt`) so a row
   * whose `started_at` ties the cursor is still fetched; the caller
   * (see lib/mileage/drive-page.ts) is the one that knows which tied row
   * was already shown and excludes it precisely, by id as well as time.
   * A strict DB-side `lt` would drop tied rows before the caller ever
   * sees them, with no way to recover them on a later page.
   */
  beforeIso?: string;
  limit?: number;
};

/** The viewer's own drives. No classification filter, by design. */
function selfQuery(
  admin: SupabaseClient,
  companyId: string,
  driverUserId: string,
  sinceIso: string,
  limit: number,
  beforeIso?: string,
) {
  const windowed = admin
    .from("mileage_trips")
    .select(TRIP_SELECT)
    .eq("company_id", companyId)
    .eq("driver_user_id", driverUserId)
    .gte("started_at", sinceIso);
  const bounded = beforeIso ? windowed.lte("started_at", beforeIso) : windowed;
  return bounded
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
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
  beforeIso?: string,
) {
  const base = admin
    .from("mileage_trips")
    .select(TRIP_SELECT)
    .eq("company_id", companyId);
  const scoped =
    "only" in target
      ? base.eq("driver_user_id", target.only)
      : base.neq("driver_user_id", target.except);
  const windowed = restrictToSharedBusiness(scoped).gte("started_at", sinceIso);
  const bounded = beforeIso ? windowed.lte("started_at", beforeIso) : windowed;
  return bounded
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
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
  { companyId, scope, sinceIso, beforeIso, limit = 500 }: TripQueryInput,
): Promise<T[]> {
  if (scope.kind === "self") {
    const { data } = await selfQuery(
      admin,
      companyId,
      scope.driverUserId,
      sinceIso,
      limit,
      beforeIso,
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
      beforeIso,
    );
    return (data ?? []) as unknown as T[];
  }
  const [own, others] = await Promise.all([
    selfQuery(admin, companyId, scope.viewerUserId, sinceIso, limit, beforeIso),
    othersQuery(
      admin,
      companyId,
      { except: scope.viewerUserId },
      sinceIso,
      limit,
      beforeIso,
    ),
  ]);
  return [
    ...((own.data ?? []) as unknown as T[]),
    ...((others.data ?? []) as unknown as T[]),
  ];
}

/**
 * Which of `ids` a scope is allowed to see, as a set.
 *
 * THIS IS WHAT LETS THE TEAM OVERLAY DRAW TEAMMATES' TRAILS AGAIN. The
 * overlay's whole job is every driver's route in their own colour, and
 * the only polyline source left is a route whose ownership probe pins
 * `driver_user_id` to the caller, so the map drew the manager's own
 * trails and nothing else while the legend still named the drivers who
 * had none.
 *
 * It answers the SAME question the drive list answers, with the same
 * queries, so a caller sees routes for exactly the drives their own list
 * already showed them: their own without restriction, a teammate's only
 * through {@link restrictToSharedBusiness}. It cannot be widened by the
 * caller, because the scope is resolved on the server by
 * {@link resolveTripScope} before this is called; the id list only ever
 * NARROWS what comes back.
 *
 * Ids that do not clear are simply absent from the set. The caller drops
 * them in silence, for the reason the route spells out: a distinguishable
 * answer for "exists but is not yours" is an oracle for guessing ids.
 */
/** A mileage_trips id probe, reduced to the chain {@link tripIdsInScope}
 *  needs. Self-referential and small, like TripQuery above and for the
 *  same TS2589 reason. */
type IdQuery = {
  eq(col: string, val: unknown): IdQuery;
  neq(col: string, val: unknown): IdQuery;
  not(col: string, op: string, val: unknown): IdQuery;
  in(col: string, vals: readonly string[]): PromiseLike<{ data: unknown }>;
};

export async function tripIdsInScope(
  admin: SupabaseClient,
  {
    companyId,
    scope,
    ids,
  }: { companyId: string; scope: TripScope; ids: readonly string[] },
): Promise<Set<string>> {
  if (ids.length === 0) return new Set<string>();
  const wanted = [...ids];
  // Cast once to the small self-referential type above, for the reason
  // TripQuery documents: resolving restrictToSharedBusiness's generic
  // against the real PostgREST builder and then chaining onto the result
  // makes tsc give up with "type instantiation is excessively deep".
  const base = () =>
    admin
      .from("mileage_trips")
      .select("id")
      .eq("company_id", companyId) as unknown as IdQuery;
  const own = (driverUserId: string) =>
    base().eq("driver_user_id", driverUserId).in("id", wanted);
  // Two statements rather than one `or(...)`, for the same reason
  // loadScopedTrips uses two: an operator-precedence mistake inside a
  // compound filter would widen the business-only restriction silently.
  const others = (target: { only: string } | { except: string }) =>
    restrictToSharedBusiness(
      "only" in target
        ? base().eq("driver_user_id", target.only)
        : base().neq("driver_user_id", target.except),
    ).in("id", wanted);

  if (scope.kind === "self") return idSet([await own(scope.driverUserId)]);
  if (scope.kind === "other")
    return idSet([await others({ only: scope.driverUserId })]);
  return idSet(
    await Promise.all([
      own(scope.viewerUserId),
      others({ except: scope.viewerUserId }),
    ]),
  );
}

function idSet(results: readonly { data: unknown }[]): Set<string> {
  const out = new Set<string>();
  for (const { data } of results)
    for (const row of (data ?? []) as { id: string }[]) out.add(row.id);
  return out;
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
