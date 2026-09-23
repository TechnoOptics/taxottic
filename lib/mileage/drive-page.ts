import type { SupabaseClient } from "@supabase/supabase-js";
import { loadScopedTrips, type TripScope } from "./team-scope";

/**
 * How many drives the first paint carries.
 *
 * The range control filters what is already loaded, so this number
 * decides which filters answer without a network call. Sixty covers a
 * month of heavy driving, which is every filter the control offers
 * except Quarter on a busy account, and stays one cheap indexed read.
 */
export const DRIVE_PAGE_SIZE = 60;

/**
 * A floor that excludes nothing.
 *
 * loadScopedTrips takes a required sinceIso because its three other
 * callers are windowed. This page is not: it opens on the newest drives
 * whenever they happened, because defaulting to Today showed a blank
 * screen to a driver whose fixes had not finished uploading, which is
 * the 24 hour median on Android.
 */
const NO_FLOOR_ISO = "1970-01-01T00:00:00.000Z";

export async function loadDrivePage<T extends { started_at: string }>(
  admin: SupabaseClient,
  {
    companyId,
    scope,
    before,
    limit = DRIVE_PAGE_SIZE,
  }: {
    companyId: string;
    scope: TripScope;
    before?: string;
    limit?: number;
  },
): Promise<T[]> {
  const rows = await loadScopedTrips<T>(admin, {
    companyId,
    scope,
    sinceIso: NO_FLOOR_ISO,
    // One extra so a cursor page can drop the cursor row and still fill.
    limit: before ? limit + 1 : limit,
  });
  if (!before) return rows;
  const cutoff = new Date(before).getTime();
  return rows
    .filter((r) => new Date(r.started_at).getTime() < cutoff)
    .slice(0, limit);
}
