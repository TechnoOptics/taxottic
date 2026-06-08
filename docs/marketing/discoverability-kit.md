# Taxottic discoverability kit

Everything needed to make Taxottic findable on search engines and
understandable to AI assistants. **On-site technical SEO is already
done in the codebase** (see "What's shipped"); this doc covers the
**off-site steps that require a human with account access** — plus
ready-to-paste copy so they take minutes, not hours.

---

## What's already shipped (in the repo)

- **Metadata** — title/description templates, Open Graph + Twitter cards, canonical URLs, `metadataBase`, keywords, `category: finance`. (`app/layout.tsx`)
- **robots.txt + sitemap.xml** — host-aware; admin subdomains noindexed. (`app/robots.ts`, `app/sitemap.ts`)
- **Structured data (JSON-LD)** — Organization, WebSite, SoftwareApplication (with priced offers), SiteNavigation, **DefinedTerm** (defines "Taxottic"), FAQPage, BreadcrumbList. (`app/page.tsx`, `app/help/page.tsx`, `app/pricing/page.tsx`, `app/legal/page.tsx`)
- **`llms.txt`** — machine-readable product summary for AI crawlers, at `https://taxottic.com/llms.txt`. (`public/llms.txt`)
- **"What is Taxottic?" FAQ** — definitional Q&A in crawlable text + schema, for featured snippets and AI answers. (`app/help/page.tsx`)
- **Search-engine verification hooks** — set the env vars below and the meta tags appear automatically.

---

## Canonical copy (paste these verbatim)

**Name:** Taxottic — pronounced "tax-OT-ic".

**Tagline:** A calmer way to handle your taxes.

**One-liner (≤160 chars):**
> Taxottic forecasts your self-employment taxes all year — bank-synced quarterly estimates and 1,025 IRS-cited deductions for freelancers and small businesses.

**One-paragraph:**
> Taxottic is tax-forecasting software for freelancers, contractors, sole proprietors, and small businesses. It connects to your bank, keeps a running quarterly estimated-tax forecast in step with your income, and surfaces 1,025 IRS-cited deductions — so you can set money aside before it's due and claim what you're legally owed. Built by Techno Optics LLC. Not a filing service and not a substitute for a licensed CPA.

**Categories:** Tax software · Accounting · Personal finance · SaaS · FinTech

**Keywords:** tax forecasting, self-employed tax software, 1099 tax estimator, Schedule C deductions, quarterly estimated tax, freelancer tax calculator, QBI deduction, small business tax.

---

## Off-site checklist (requires your accounts — I can't create these)

### 1. Search engines (highest priority)
- [ ] **Google Search Console** (search.google.com/search-console): add property `taxottic.com`. Verify with the **HTML-tag** method → paste the token into Vercel env `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` → redeploy → click Verify. Then **Sitemaps → submit** `https://taxottic.com/sitemap.xml`. Use **URL Inspection → Request indexing** on `/`, `/pricing`, `/help`.
- [ ] **Bing Webmaster Tools** (bing.com/webmasters): add the site, verify via meta tag → Vercel env `NEXT_PUBLIC_BING_SITE_VERIFICATION` → redeploy. Submit the sitemap. (Bing also feeds DuckDuckGo and ChatGPT search.)
- [ ] **Google Rich Results Test** (search.google.com/test/rich-results) on `/` and `/help` — confirm Organization, SoftwareApplication, FAQ, and DefinedTerm parse clean.

### 2. Knowledge graph / entity (helps Google + AI "know what it is")
- [ ] **Wikidata** (wikidata.org): create an item "Taxottic" — instance of *software*, with official website, developer (Techno Optics LLC), and the description above. Wikidata is ingested by Google's Knowledge Graph and most AI training pipelines. (Free, no notability bar like Wikipedia.)
- [ ] **Crunchbase**: create a company profile (product + organization). High domain authority; widely crawled by AI.
- [ ] **LinkedIn Company Page** for Taxottic (and link from Techno Optics).

### 3. Software directories (backlinks + AI ingestion)
- [ ] **Product Hunt** launch (drives a spike of links + social).
- [ ] **G2**, **Capterra**, **GetApp** (Gartner network — strong for "tax software" queries).
- [ ] **SaaSHub**, **AlternativeTo**, **Slashdot/SourceForge** — list as an alternative to TurboTax / QuickBooks Self-Employed / Keeper Tax. These pages rank for "[competitor] alternative" and are ingested by AI.

### 4. Social presence (for `sameAs` + brand signals)
- [ ] Claim **@taxottic** on X/Twitter, LinkedIn, and (optionally) YouTube/Instagram. Once live, add the handle in two places:
  - `app/layout.tsx` → `twitter.site` / `twitter.creator`
  - `app/page.tsx` → `ORGANIZATION_LD.sameAs` array (add each profile URL)
- This lets Google connect the brand to its verified profiles in the knowledge panel.

### 5. Content (compounding, long-term)
- [ ] A small blog under `/help/<topic>` or `/blog`: "How much should I set aside for self-employment tax?", "Schedule C deductions you're probably missing", "Quarterly estimated taxes explained." Question-shaped titles win featured snippets *and* are the exact phrasing AI assistants retrieve.

---

## About "adding it to the dictionary"

A brand name can't be submitted to a language dictionary — Merriam-Webster
and the OED only add words after documenting widespread public usage over
time. The machine-readable equivalent **is** shipped: the `DefinedTerm`
JSON-LD on the homepage formally defines "Taxottic" (with pronunciation
and meaning) for knowledge graphs and AI crawlers, and the Wikidata item
above is the single most effective lever for getting AI assistants to
state what Taxottic is. As real usage grows, that's also what eventually
makes a Wikipedia article notable enough to stick.
