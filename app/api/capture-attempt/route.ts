import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const VALID_KINDS = new Set([
  "right_click",
  "save_shortcut",
  "print_shortcut",
  "print_screen",
  "devtools_open",
  "image_drag",
  "unauthorized_print",
]);

/**
 * Audit-log endpoint for the NoCapture client component. Accepts a
 * sendBeacon POST (no auth header on those, so we resolve the user
 * via the SSR cookies instead). Anonymous trips are still logged with
 * user_id NULL so we capture marketing-page right-clicks too.
 *
 * Best-effort: this never throws back to the client. If logging fails,
 * the user-facing deterrent UI continues to work.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      kind?: string;
      path?: string;
      details?: Record<string, unknown> | null;
    };
    const kind = String(body?.kind ?? "");
    if (!VALID_KINDS.has(kind)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const userAgent = req.headers.get("user-agent") ?? null;
    // Prefer the forwarded chain Vercel injects so we get the real IP;
    // fall back to nothing rather than logging the load-balancer.
    const ipChain =
      req.headers.get("x-forwarded-for") ??
      req.headers.get("x-real-ip") ??
      null;
    const ip = ipChain ? ipChain.split(",")[0].trim() : null;

    const admin = createServiceClient();
    await admin.from("capture_attempts").insert({
      user_id: user?.id ?? null,
      kind,
      path: typeof body?.path === "string" ? body.path.slice(0, 512) : null,
      user_agent: userAgent ? userAgent.slice(0, 512) : null,
      ip,
      details: body?.details ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Never let logging errors leak to the user.
    return NextResponse.json({ ok: false });
  }
}
