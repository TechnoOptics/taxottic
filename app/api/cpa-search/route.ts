import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchCpas } from "@/lib/places/cpa-search";

export const runtime = "nodejs";

/**
 * Search for accounting / tax-prep firms near a location. Accepts
 * either lat/lng (from browser geolocation) or a free-text query
 * like "tax preparer Austin TX". When GOOGLE_PLACES_API_KEY is
 * unset, returns 200 with `results: null` so the UI knows to fall
 * back to the Maps link.
 *
 * Auth: signed-in users only (cheap rate-limit via that boundary).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const lat = typeof body?.lat === "number" ? body.lat : null;
  const lng = typeof body?.lng === "number" ? body.lng : null;
  const query =
    typeof body?.query === "string" ? body.query.trim().slice(0, 200) : null;

  try {
    let results;
    if (lat != null && lng != null) {
      results = await searchCpas({ kind: "geo", lat, lng }, 6);
    } else if (query) {
      results = await searchCpas({ kind: "text", query }, 6);
    } else {
      return NextResponse.json(
        { error: "Provide either lat/lng or a query." },
        { status: 400 },
      );
    }
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 502 },
    );
  }
}
