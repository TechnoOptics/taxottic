import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component; middleware refreshes the session.
          }
        },
      },
    },
  );
}

export function createServiceClient() {
  return serviceClient();
}

/**
 * A service-role client whose every request goes through `fetchImpl`.
 *
 * The one caller is lib/hq/elevated-client.ts, which uses it to install the
 * fleet sandbox boundary on the operator console's reads. Fleet contract 6.5:
 * "The check belongs at the chokepoint, not at each call site." The `fetch` a
 * client is built with is that chokepoint, because every PostgREST request
 * the client ever issues passes through it.
 *
 * lib/hq/elevated-call-sites.test.ts holds this to that single caller. It
 * builds a privileged client and is not matched by the `createServiceClient()`
 * invocation count, so a second caller would be a bypass that moves no number.
 */
export function createServiceClientWithFetch(fetchImpl: typeof fetch) {
  return serviceClient(fetchImpl);
}

function serviceClient(fetchImpl?: typeof fetch) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
    },
  );
}
