import type { Metadata } from "next";

/**
 * Shared metadata builder for the free-calculator pages.
 *
 * Every calculator page wants the same shape: standard SEO metadata
 * plus a dynamic OG image that reflects a shared result (the inputs in
 * the query string), while keeping a param-free canonical so search
 * indexes one version. This centralizes that so each page is a few
 * lines instead of a 40-line metadata block.
 */

export type Search = Promise<Record<string, string | string[] | undefined>>;

/** Flatten Next's `string | string[] | undefined` search params to a
 *  plain string map (first value wins). */
export function readSearch(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) {
    out[k] = (Array.isArray(v) ? v[0] : v) ?? undefined;
  }
  return out;
}

export function buildCalcMetadata(opts: {
  slug: string;
  title: string;
  description: string;
  keywords: string[];
  /** OG image variant, matches the `calc` switch in /api/og/calc. */
  calc: string;
  sp: Record<string, string | string[] | undefined>;
  /** Which query keys to forward into the OG image URL. */
  ogKeys: string[];
}): Metadata {
  const flat = readSearch(opts.sp);
  const ogParams = new URLSearchParams({ calc: opts.calc });
  for (const key of opts.ogKeys) {
    const val = flat[key];
    if (val) ogParams.set(key, val);
  }
  const ogUrl = `/api/og/calc?${ogParams}`;
  const canonical = `/calculators/${opts.slug}`;

  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical },
    openGraph: {
      title: opts.title,
      description: opts.description,
      url: canonical,
      type: "website",
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description: opts.description,
      images: [ogUrl],
    },
    keywords: opts.keywords,
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-snippet": -1,
        "max-image-preview": "large",
      },
    },
  };
}
