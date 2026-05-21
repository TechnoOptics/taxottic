"use server";

import { revalidatePath } from "next/cache";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { geocodeAddress } from "@/lib/maps/geocode";

const PLACE_KINDS = new Set(["home", "office", "client", "other"]);
const MIN_RADIUS_M = 20;
const MAX_RADIUS_M = 5000;
const DEFAULT_RADIUS_M = 120;

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Add a saved location so the mileage tracker can auto-classify
 * future trips that start or end nearby. Office / client places make
 * a touching trip "business" automatically. Home places make a
 * home-to-home trip "personal". This is the existing
 * lib/mileage/segmentation.ts heuristic — this UI just lets the user
 * feed it.
 *
 * Form fields:
 *   - label         : human-readable name ("HQ", "Client X")
 *   - kind          : "home" | "office" | "client" | "other"
 *   - address       : free-form, geocoded server-side
 *   - radius_m      : geofence radius (default 120 m, clamped to 20-5000)
 */
export async function addMileagePlace(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { admin, user } = await requireUserWithAdmin();
  const companies = await getMyCompanies();
  const companyId = companies[0]?.company.id;
  if (!companyId) {
    return { ok: false, error: "Set up a company first, then save places." };
  }

  const label = String(formData.get("label") ?? "").trim();
  const kindRaw = String(formData.get("kind") ?? "other");
  const address = String(formData.get("address") ?? "").trim();
  const radiusRaw = Number(formData.get("radius_m") ?? DEFAULT_RADIUS_M);

  if (!label) return { ok: false, error: "Give the place a name." };
  if (!address) return { ok: false, error: "Add an address." };
  if (!PLACE_KINDS.has(kindRaw)) {
    return { ok: false, error: "Pick a category." };
  }
  const radius_m = Math.max(
    MIN_RADIUS_M,
    Math.min(MAX_RADIUS_M, Number.isFinite(radiusRaw) ? radiusRaw : DEFAULT_RADIUS_M),
  );

  const geo = await geocodeAddress(address);
  if (!geo.ok) {
    const msg =
      geo.error.code === "no_key"
        ? "Address lookup isn't configured yet (server missing Maps key)."
        : geo.error.code === "not_found"
          ? "Couldn't find that address. Try a more specific one."
          : geo.error.code === "rate_limited"
            ? "Address lookup is busy. Wait a moment and try again."
            : "Address lookup failed. Check your connection.";
    return { ok: false, error: msg };
  }

  const { error: insertErr } = await admin.from("mileage_places").insert({
    company_id: companyId,
    created_by: user.id,
    kind: kindRaw,
    label,
    lat: geo.result.lat,
    lng: geo.result.lng,
    radius_m,
  });
  if (insertErr) {
    return { ok: false, error: "Couldn't save the place. Please try again." };
  }

  // The mileage breadcrumb map + business dashboard both read places,
  // and /mileage/places lists them. Revalidate all three so the new
  // pin appears immediately wherever the user lands next.
  revalidatePath("/mileage");
  revalidatePath("/mileage/business");
  revalidatePath("/mileage/places");
  return { ok: true };
}

/**
 * Delete a saved place. Re-checks the place belongs to a company the
 * user is a member of before touching it (RLS is permissive on
 * mileage_places, same pattern as the ingest endpoint).
 */
export async function deleteMileagePlace(formData: FormData): Promise<void> {
  const { admin, user } = await requireUserWithAdmin();
  const placeId = String(formData.get("place_id") ?? "").trim();
  if (!placeId) return;

  const { data: row } = await admin
    .from("mileage_places")
    .select("id, company_id")
    .eq("id", placeId)
    .maybeSingle();
  if (!row) return;
  const { data: member } = await admin
    .from("company_members")
    .select("user_id")
    .eq("company_id", (row as { company_id: string }).company_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return;

  await admin.from("mileage_places").delete().eq("id", placeId);
  revalidatePath("/mileage");
  revalidatePath("/mileage/business");
  revalidatePath("/mileage/places");
}
