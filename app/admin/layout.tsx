import type { Metadata } from "next";

/**
 * Metadata-only layout for the operator console.
 *
 * Both admin hosts rewrite into this tree (hq.taxottic.com/users →
 * /admin/users, enterprise.taxottic.com/firms → /admin/firms; see
 * lib/supabase/middleware.ts), so this is the one segment that covers every
 * admin page on every host.
 *
 * The title and robots block below used to live in the root layout's
 * generateMetadata, selected by reading the request host with `headers()`.
 * That single dynamic call cost the whole application static generation
 * (3 static routes instead of 40). Static metadata on this segment produces
 * exactly the same <meta name="robots"> and the same tab title without
 * reading a header, and it also covers /admin/** on the consumer host, which
 * the host-sniffing version did not.
 *
 * The host-level guarantee is the `X-Robots-Tag` response header that
 * middleware sets on every admin-host response. This layout is the second
 * layer, and the one that keeps the operator-facing title.
 *
 * Rendering is untouched: this returns children unchanged. Access control
 * stays where it already is, in each page's own requireSuperAdmin guard.
 */
export const metadata: Metadata = {
  title: {
    // `absolute`, not `default`: this segment has a parent (the root layout)
    // whose "%s | Taxottic" template would otherwise be applied, turning the
    // console title into "Taxottic cockpit | Taxottic". `absolute` reproduces
    // exactly what the old host-sniffing branch produced. The template still
    // applies to any admin page that sets its own title (none do today).
    absolute: "Taxottic cockpit",
    template: "%s | Taxottic cockpit",
  },
  description: "Operator console, not for public access.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-snippet": 0,
      "max-image-preview": "none",
      "max-video-preview": 0,
    },
  },
  openGraph: {
    title: "Taxottic cockpit",
    description: "Operator console, not for public access.",
    url: "/",
    siteName: "Taxottic",
    type: "website",
  },
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
