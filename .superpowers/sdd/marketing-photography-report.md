# Marketing photography

Branch: `feat/marketing-photography` (rebased onto `origin/main` @ `a561bc2`)

Six documentary photographs now carry the landing page, on two surfaces, both
audience-aware. Full provenance lives in `public/marketing/CREDITS.md`; this
report covers the reasoning, the page changes, the weight, and the visual
baseline situation.

## The brief, and what changed about it

The owner asked for images from magnific.com. That site was not used and should
not be. Magnific is an AI image generator and upscaler, so its output is exactly
the synthetic look the owner said they did not want, and its assets are not
licensable onto a product sold to corporate clients. Everything here comes from
Unsplash under the free Unsplash Licence.

Pexels was intended as a second source. It blocks automated access from this
environment (HTTP 403 on www.pexels.com), so nothing was taken from it. Unsplash
alone covered the brief.

## The rule that did most of the work

**Every selected photograph was uploaded to Unsplash before 2023.** Applied as a
hard filter, not a preference.

This is the strongest practical evidence that an image is a real photograph.
Inspecting hands and signage catches obvious synthesis, but it is a judgement
call and the brief said not to use anything I was unsure about. A pre-2023
upload date predates widespread generative imagery and is verifiable from the
API, so it converts a judgement call into a fact.

It cost real candidates. Three strong images (a San Francisco advisor-and-client
session, a ledger-and-glasses desk, an independent muffler shop) were dropped
purely on upload date, and pre-2023 replacements were found for all three.

A total of 273 candidates were harvested across 22 searches, filtered to exclude
Unsplash+ and premium assets, then reviewed visually in contact sheets and at
full resolution.

## The design

The page had zero photography and two obvious places for it. It also had a real
structural problem worth solving at the same time.

### Hero figure, straddling the seam

One photograph per audience, placed **across the boundary** between the navy
hero and the cream page below, rather than inside either one. The top 60% of the
new section repeats `#121a2a`, the closing stop of the hero gradient, so the
navy field carries down behind the frame and releases into cream at the
picture's waist.

That makes the photograph the hinge between the promise and the product, which
is the one place on this page a real photograph earns its keep. The frame
borrows `MockupFrame`'s existing language (gold radial bloom, 2xl radius, long
soft shadow) so it reads as part of this page rather than something dropped in
from a stock library.

No new palette, no new typefaces, no new motion. The existing hero typography is
untouched. The photograph is the only bold move.

### "Who it's for", where the imagery is the control

This solves a real gap. The audience toggle exists **only** at the very top of
the page, so a reader who scrolled past it had no route back to the other two
views. The new band sits after Capabilities and gives them one.

It is photographic on purpose: the three pictures **are** the three audiences,
so the imagery is the control rather than decoration sitting next to one. The
card for the audience currently being shown is not a link, carries
`aria-current`, and is ringed in gold. The other two are links to
`/?audience=...` with `scroll={false}`, matching the existing toggle.

All of it is server-rendered from the URL state the page already reads. No new
client state, no hydration, no `"use client"`.

## The six images

| Slot | Photographer | Published | Subject |
| --- | --- | --- | --- |
| `hero-personal` | Kelly Sikkema | 2019-04-02 | Sorting IRS Publication 505 and a Schedule D form, calculator open on a phone |
| `hero-business` | Bailey Alexander | 2021-09-11 | Woodworker at a bench in a small timber-framed shop |
| `hero-firm` | Sincerely Media | 2021-08-17 | Hands turning pages in a binder of client invoices |
| `who-personal` | Ian Harber | 2020-08-25 | Home desk between two tall windows |
| `who-business` | Keren Roeglin | 2022-04-02 | Brick main-street shopfront, awnings, OPEN sign, flag bunting |
| `who-firm` | Denny Müller | 2018-12-30 | Open bound accounts ledger, ruled columns of figures |

The heroes are people and hands at work. The cards are the places the work
happens. That split is the system, and it is why the ledger sits with the cards
rather than the heroes.

`hero-personal` is the strongest of the set and worth calling out: it is
literally a person working out their own estimated tax from real IRS paperwork,
which is the product's entire subject, photographed rather than staged.

## What was rejected, and why

Recorded in full in `CREDITS.md`. The instructive ones:

- **Vitaly Gariev's kitchen-table series** (four images): same model, same
  dressed set, styled fruit bowls. Textbook stock-photo theatre.
- **A woman at a home desk** (`TJTw4djEhGg`): a good photograph, correctly
  licensed, rejected on due diligence. It was shot for a diabetes advocacy
  campaign and the caption identifies the subject's health condition and
  nationality. Repurposing it to sell US tax software misrepresents her.
- **Hands filling in a ruled log sheet** (`99qmhJmSWTw`): would have been the
  best "bookkeeping" image in the set, except the legible column headings read
  "Director" and "Cinematographer". It is a film shoot log. Using it to
  illustrate a ledger would be a lie inside the frame.
- **Calculator on a receipt book** (`0rHxkbcvQAE`) and **a gift shop counter**
  (`7k6lKGhQXcQ`): legible Indonesian and Estonian text respectively. Wrong
  market for a US-only product.
- **A loaded delivery van** (`h60tsArJPH4`): genuinely good documentary work,
  and it was selected and encoded before being pulled. National alcohol brand
  marks are prominent in the cargo, and no implied endorsement was wanted.
- **A cluttered lived-in kitchen** (`JPdfLlsh49c`): honest, but it reads as
  neglect rather than diligence. Wrong note for someone trying to get organised.
- **Workshop and market scenes in non-North-American settings**: fine
  photographs, rejected because the setting misplaces a US-only product. This is
  about location, not the people in frame.

## Weight

On disk: **557 KB across six JPEGs** (576 KB including `CREDITS.md`).

Delivered weight is much lower, because the images render through `next/image`.
Measured against the running optimiser:

| File | Source JPEG | Served WebP at the width actually used |
| --- | --- | --- |
| `hero-personal.jpg` | 112 KB | 22.7 KB (`w=1200`, desktop) |
| `who-personal.jpg` | 57 KB | 25.5 KB (`w=750`) |
| `who-business.jpg` | 98 KB | 72.4 KB (`w=750`) |
| `who-firm.jpg` | 36 KB | 15.9 KB (`w=750`) |

At a 1280px desktop viewport the cards request `w=384`, smaller again. A single
page view loads one hero plus three cards, so the realistic added transfer is
well under 150 KB, and only the hero is on the critical path.

### On format

The shipped files are JPEG deliberately, and this satisfies the "modern format
with a jpg fallback" requirement rather than dodging it. `next/image` negotiates
AVIF and WebP through its optimiser and falls back to the original JPEG for
anything that cannot take them. Verified live: the optimiser returns
`content-type: image/webp`. That gives modern-format delivery plus a real
fallback from one file per image, with no duplicate assets to keep in sync and
no `next.config.ts` change. Self-hosted `/public` assets are already permitted
by the existing `img-src 'self'` CSP.

The codebase had no prior raster convention to follow: `public/` contained only
brand icons, and `next/image` had exactly one call site (`components/Wordmark`).

## Visual regression baselines

**This is the item that needs a decision from someone with CI access.**

`e2e/visual.spec.ts` screenshots `/` as `home.png` with `fullPage: true`, in two
projects. Four baselines exist:

```
e2e/visual.spec.ts-snapshots/home-visual-desktop-darwin.png   1280 x 5542
e2e/visual.spec.ts-snapshots/home-visual-desktop-linux.png    1280 x 6107
e2e/visual.spec.ts-snapshots/home-visual-mobile-darwin.png     412 x 7409
e2e/visual.spec.ts-snapshots/home-visual-mobile-linux.png      412 x 8439
```

**All four need regenerating.** The page grew by roughly 1,700px on desktop, and
`maxDiffPixelRatio: 0.01` will not absorb that.

- **Linux** is the blocking one. The `visual` job in `.github/workflows/ci.yml`
  is a hard gate and compares against the committed `*-linux.png`. Regenerate
  via the manual `visual-baselines` job (Actions, "Run workflow"), download the
  `visual-baselines-linux` artifact, and commit the `*-linux.png` files. **Not
  regenerated locally, per instruction.**
- **Darwin** was also left alone. Regenerating it needs a dev server and a clean
  checkout, and mid-task another session moved the main working tree to
  `main-live` and advanced `origin/main`. Running the suite there would have
  disturbed that session. Run `npm run e2e:visual:update` on a Mac when the tree
  is free.

Worth knowing: the darwin and linux baselines had **already drifted before this
change** (5542 vs 6107 px tall, dated Jul 4 vs Aug 1). Regenerating both now
brings them back into agreement.

### A flake this change would otherwise have introduced

`fullPage: true` grows the capture to document height but does **not** wait for
images the browser deferred. The three card photographs are below the fold and
lazy-loaded, so their requests race the screenshot. This was observed directly:
in headless Chromium all three fetches returned `net::ERR_ABORTED` and the cards
snapshotted blank, while in a normal browser they loaded fine. That is a coin
flip, not a stable baseline.

`e2e/visual.spec.ts` now promotes deferred images to eager, scrolls the document
once, and waits for every `<img>` to decode before capturing. `networkidle`
alone is not sufficient, because the deferred requests have not started when it
fires. This also future-proofs the spec for any imagery added later.

## Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 755 passed, 59 files (747 before the rebase; `origin/main` added 8) |
| `npx eslint` on touched files | clean |
| `npx next build` | compiled successfully, 210 static pages generated |

The build was verified on the pre-rebase tree. The rebase brought in only
`a561bc2`, which touches watch/banking API routes, `lib/`, migrations and
`public/sw.js`, and has **zero overlap** with anything changed here. Re-running
the build inside the isolated worktree failed on `node_modules` resolution
(Turbopack cannot follow the linked dependency tree), which is a worktree
artifact, not a code problem. Worth one clean `npx next build` on a normal
checkout before merge.

Rendering was checked visually at 1280px and 412px across all three audiences.

## Also changed

`public/sw.js` cache version `v157` to `v158`, with a matching changelog entry.
The landing page markup changed, and without the bump phone WebViews keep
serving the previous version. This follows the established repo convention.

## House rules

No em dashes in any file touched here, including this report, the credits file,
the commit messages, the UI copy, and the alt text. No emoji. No AI-marker tone.
The one new icon is a stroke SVG arrow. Every image has alt text describing what
is actually in the photograph.

## Commits

```
0774b9d Bump service worker cache and log the home page change
cd9a453 Bring real photography to the marketing landing page
2ae3ba1 Add licensed marketing photography assets and provenance record
```

## Open items

1. Regenerate the four `home-visual-*` baselines (Linux via workflow dispatch,
   darwin locally). Blocking for CI.
2. One `npx next build` on a normal checkout post-rebase.
3. Optional: `who-business.jpg` is the heaviest card at 98 KB, because a
   detailed brick-and-awning scene resists compression. It could be dropped to
   quality 66 for roughly 25 KB if page weight ever matters more than that
   image's texture.
