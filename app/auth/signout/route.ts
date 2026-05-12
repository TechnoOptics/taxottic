import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

async function handle(request: Request) {
  const cookieStore = await cookies();
  const { origin } = new URL(request.url);

  // Where to land after the cookies are cleared. Defaults to /login, but
  // the "Switch accounts" item in the profile menu posts next=/login?force_picker=1
  // so the login page knows to ask the OAuth provider for a fresh account
  // chooser instead of silently auto-resuming the last session.
  // - GET: read from the query string (rare; mostly direct-URL hits).
  // - POST: read from form data (the normal case from <form action="/auth/signout">).
  // We only honor relative paths starting with "/" to defeat open-redirect.
  let nextPath = "/login";
  try {
    if (request.method === "POST") {
      const fd = await request.clone().formData();
      const raw = fd.get("next");
      if (typeof raw === "string" && raw.startsWith("/")) {
        nextPath = raw;
      }
    } else {
      const raw = new URL(request.url).searchParams.get("next");
      if (raw && raw.startsWith("/")) {
        nextPath = raw;
      }
    }
  } catch {
    // Fall through to the /login default; a malformed form body shouldn't
    // strand the user without a sign-out.
  }

  // Build the redirect response up front so the Supabase client can write
  // its cookie clears DIRECTLY onto the response that goes back to the
  // browser. The default factory in lib/supabase/server.ts writes cookies
  // through next/headers' cookieStore, which only attaches to Next's
  // implicit response. When this handler returns its own NextResponse,
  // those clears never leave the server -> browser keeps the auth cookie
  // -> next request still authenticates as the previous user. That was
  // the cross-tenant leak: signOut "succeeded" server-side but the
  // sb-*-auth-token cookies survived the redirect, so the next sign-in
  // overlaid a new session on top of the old cookie state and RLS still
  // saw auth.uid() = old user.
  const response = NextResponse.redirect(`${origin}${nextPath}`, {
    status: 303,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            // Mirror to both stores: cookieStore so any code that runs
            // later in this request sees the cleared session, and
            // response.cookies so the browser actually receives the
            // Set-Cookie clears.
            try {
              cookieStore.set(name, value, options);
            } catch {
              // setAll from a route handler can throw on the request-store
              // path in some Next render contexts. The response.cookies
              // write below is what the browser actually consumes.
            }
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // signOut is a no-op if the user isn't signed in - safe regardless of state.
  await supabase.auth.signOut();

  // Bust the Next.js Router Cache and RSC payload cache. Without this,
  // even after the cookie is cleared the client still has the previous
  // user's prefetched payload for /dashboard, /c/[publicId]/*, etc.
  // Logging in as a different user would render their UI from the cached
  // payload until a hard navigation forced a re-fetch.
  revalidatePath("/", "layout");

  // Defeat browser bfcache. Without no-store, hitting Back after a fresh
  // sign-in restores the prior user's HTML snapshot from the bfcache
  // even though cookies have rotated.
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  return response;
}

// Accept both methods so that a stale session redirected here, a direct GET
// from typing the URL, or the normal form POST all do the right thing.
export const POST = handle;
export const GET = handle;
