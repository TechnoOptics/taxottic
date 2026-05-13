import { redirect } from "next/navigation";

// /admin/dashboard catch-route.
//
// Why this file exists: when the May 2026 three-portal split shipped,
// any code path that did `redirect("/dashboard")` from inside an
// /admin/** page on hq.taxottic.com or enterprise.taxottic.com got
// rewritten by the middleware to `/admin/dashboard`. That route didn't
// exist, so users hit the "personal day" 404 instead of landing on
// taxottic.com/dashboard like the code intended.
//
// requireSuperAdmin in lib/auth.ts now detects the admin host and
// redirects absolute to https://taxottic.com/dashboard, which is the
// proper fix. This file is the safety net for any other code path
// (today or future) that emits a relative `/dashboard` redirect from
// an admin context — instead of 404ing, the user lands here and we
// bounce them to the right consumer URL.
//
// Equivalent insurance for `/admin/firm`, `/admin/firm/<id>`, etc.
// isn't needed because those are real pages under /admin/firms.
export default function AdminDashboardRedirect() {
  const origin = (
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://taxottic.com"
  ).replace(/\/$/, "");
  redirect(`${origin}/dashboard`);
}
