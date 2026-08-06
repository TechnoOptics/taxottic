import type { Metadata } from "next";

/**
 * Metadata-only layout for the sign-in screen.
 *
 * app/login/page.tsx is a client component, so it cannot export metadata
 * itself and inherits the root layout's consumer SEO payload, including
 * `robots: index, follow`.
 *
 * That inherited `index, follow` is wrong on two counts. app/robots.ts has
 * always listed `/login` under `disallow`, so the site has never wanted this
 * page in an index. And /login is one of the few paths that middleware lets
 * through unrewritten on hq./enterprise.taxottic.com, so on the admin hosts
 * the inherited tag directly contradicted the `X-Robots-Tag: noindex` that
 * middleware sets there. Search engines resolve that conflict in favour of
 * the more restrictive directive, but shipping the contradiction at all on
 * an operator host is not worth the argument.
 *
 * Declaring noindex here states the intent that robots.txt already encoded,
 * on every host, in the page's own HTML.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
