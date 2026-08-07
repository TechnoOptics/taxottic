# Marketing photography credits

Every photograph used on the public marketing surface is listed here with its
source, photographer, licence, and download date. Nothing ships to production
without a verifiable licence entry in this file.

## Licence

All images below are published on Unsplash under the **Unsplash Licence**
(https://unsplash.com/license), which grants an irrevocable, non-exclusive,
worldwide copyright licence to download, copy, modify, distribute, perform, and
use the photo for free, including for commercial purposes, with no permission
from or attribution to the photographer required.

We credit the photographers here anyway. Attribution is not required by the
licence, so no credit line is rendered on the page itself.

The licence does not permit compiling photos to replicate a competing service,
and does not grant rights in trademarks, logos, or the likeness of people or
property depicted. Neither applies to the use here: the photographs are used as
editorial context on our own marketing page.

## Sourcing rules applied

1. **Unsplash only.** Pexels was intended as a second source but blocks
   automated access from this environment (HTTP 403 on www.pexels.com), so no
   Pexels image is used. Everything here is Unsplash.
2. **No Unsplash+ / premium assets.** Only photos under the free Unsplash
   Licence were considered. Any result flagged `plus` or `premium` was excluded
   before review.
3. **Uploaded before 2023.** Every selected photograph was published to
   Unsplash before generative image models were in widespread use. This is a
   hard filter, not a preference: it is the strongest available evidence that
   an image is a real photograph. Several otherwise-good 2025 and 2026 uploads
   were dropped for this reason alone.
4. **Visually reviewed at full resolution.** Each candidate was inspected for
   AI tells (hand and finger anatomy, impossible geometry, plastic skin,
   nonsense text on signage) and for stock-photo theatre (posed handshakes,
   direct-to-camera grins, whiteboard pointing, glossy composites).
5. **Legible text must be true.** Any photograph whose readable text
   contradicted the claim being made, or was in a language that misplaces the
   product's US market, was rejected.
6. **No third-party trademarks in frame.** Recognisable national brand marks
   were avoided so no unintended endorsement is implied.

## Images in use

### hero-personal.jpg

- Rendered: hero figure, personal audience (`/` and `/?audience=personal`)
- Source: https://unsplash.com/photos/person-holding-paper-near-pen-and-calculator-xoU52jUVUXA
- Photographer: Kelly Sikkema (@kellysikkema)
- Licence: Unsplash Licence
- Published: 2019-04-02
- Downloaded: 2026-08-06
- Original: 5563 x 3192. Shipped: 1600 x 900, JPEG, 112 KB
- Subject: a person sorting IRS Publication 505 (Tax Withholding and Estimated
  Tax) and a Schedule D form on a table, with a calculator open on a phone.
- Why: it is literally what the product is about, a person working out their own
  estimated tax from real IRS paperwork. Documentary, not staged.

### hero-business.jpg

- Rendered: hero figure, business audience (`/?audience=business`)
- Source: https://unsplash.com/photos/a-man-working-in-a-woodworking-shop-IDVRm7j2ZCc
- Photographer: Bailey Alexander (@baileyal3xander)
- Licence: Unsplash Licence
- Published: 2021-09-11
- Downloaded: 2026-08-06
- Original: 6000 x 4000. Shipped: 1600 x 900, JPEG, 151 KB
- Subject: a woodworker at a bench in a small timber-framed workshop, wood
  shavings and hand planes in the foreground.
- Why: a genuine one-person trade shop, the Schedule C customer. Working, not
  posing, and the room is real rather than dressed.

### hero-firm.jpg

- Rendered: hero figure, firm audience (`/?audience=firm`)
- Source: https://unsplash.com/photos/woman-in-white-long-sleeve-shirt-sitting-beside-brown-wooden-table-QMOtAxa_BQY
- Photographer: Sincerely Media (@sincerelymedia)
- Licence: Unsplash Licence
- Published: 2021-08-17
- Downloaded: 2026-08-06
- Original: 5472 x 3648. Shipped: 1600 x 900, JPEG, 103 KB
- Subject: hands turning pages in a thick ring binder of invoices and
  statements on a wooden desk.
- Why: the honest picture of a practice's day, working through a client's
  paperwork. No faces, so it implies no particular firm or demographic.

### who-personal.jpg

- Rendered: "Who it's for" card, personal
- Source: https://unsplash.com/photos/man-in-white-dress-shirt-sitting-on-chair-using-laptop-computer-cu7KouQ5FJE
- Photographer: Ian Harber (@ianharber)
- Licence: Unsplash Licence
- Published: 2020-08-25
- Downloaded: 2026-08-06
- Original: 6000 x 4000. Shipped: 720 x 540, JPEG, 57 KB
- Subject: a person working at a laptop at a home desk between two tall
  windows, with a desk lamp lit.
- Why: the spare-room desk where a freelancer or side-hustler actually does
  this work. Warm, ordinary, no lifestyle gloss.

### who-business.jpg

- Rendered: "Who it's for" card, business
- Source: https://unsplash.com/photos/a-man-walking-past-a-store-front-on-a-city-street-6eEwUpLghHU
- Photographer: Keren Roeglin (@kerenroeglin)
- Licence: Unsplash Licence
- Published: 2022-04-02
- Downloaded: 2026-08-06
- Original: 6000 x 4000. Shipped: 720 x 540, JPEG, 98 KB
- Subject: a brick main-street shopfront with striped awnings, an OPEN sign, a
  chalkboard, and flag bunting.
- Why: an unmistakably North American independent storefront, matching the
  customer base. The only text in frame is the business's own signage.

### who-firm.jpg

- Rendered: "Who it's for" card, firm
- Source: https://unsplash.com/photos/white-printer-paper-with-black-text-jLjfAWwHdB8
- Photographer: Denny Müller (@redaquamedia)
- Licence: Unsplash Licence
- Published: 2018-12-30
- Downloaded: 2026-08-06
- Original: 5472 x 3648. Shipped: 720 x 540, JPEG, 36 KB
- Subject: an open bound accounts ledger, ruled columns of figures in shallow
  focus.
- Why: the practice's own instrument. Textural rather than literal, so it sits
  quietly next to two photographs that contain rooms.

## Processing

Sources were downloaded at 2600px wide, quality 92, then cropped and
re-encoded with sharp (mozjpeg, progressive, 4:4:4 chroma) to the shipped
dimensions above. Heroes are 16:9 at 1600 x 900; cards are 4:3 at 720 x 540.

The shipped files are JPEG on purpose. They are rendered through `next/image`,
whose optimiser negotiates AVIF and WebP to browsers that accept them and falls
back to the original JPEG for those that do not. That gives modern-format
delivery with a real fallback from one file per image, with no duplicate assets
to keep in sync and no `next.config.ts` change. Self-hosted `/public` assets are
already allowed by the `img-src 'self'` content security policy.

Total on disk: 557 KB across six files. A single page view loads one hero plus
three cards, and only at the widths `next/image` selects for the viewport.

## Rejected candidates worth recording

These were reviewed and deliberately not used. Recorded so the same ground is
not covered twice.

- **Vitaly Gariev, kitchen table series** (4XBvbznJFno, Ve4FEk-swHY,
  8DusFbeYa6o, WyyP2PsmwKw): same model, same dressed set, styled fruit bowls.
  Stock-photo theatre.
- **Sweet Life, woman at home desk** (TJTw4djEhGg): a good photograph, but it
  was shot for a diabetes advocacy campaign and the caption identifies the
  subject's health condition and nationality. Repurposing it to sell US tax
  software misrepresents the subject.
- **Camera-log sheet being filled in** (99qmhJmSWTw): strong image, but the
  legible form headings read "Director" and "Cinematographer". It is a film
  shoot log, not a ledger. Using it to illustrate bookkeeping would be a lie in
  the frame.
- **Casio calculator on a receipt book** (0rHxkbcvQAE): legible Indonesian text
  ("Nota Penjualan LPG"). Wrong market.
- **Gift shop owner at her counter** (7k6lKGhQXcQ): legible Estonian signage,
  and a direct-to-camera smile that reads as stock.
- **Loaded delivery van** (h60tsArJPH4): genuinely good documentary photograph
  of a working van, rejected only because national alcohol brand marks are
  prominent in the cargo. No implied endorsement wanted.
- **Cluttered lived-in kitchen** (JPdfLlsh49c): honest, but reads as neglect
  rather than diligence. Wrong note for a customer who is trying to get
  organised.
- **Multi-bay workshop with trucks on lifts** (c-KDq7nxVdQ): reads as a
  dealership service centre, not an independent small business.
- **Workshop and market scenes in non-North-American settings** (PxlKOcj0a3Q,
  WpmmCFQoGG0, t7vUl63JK1M, gakuij2BVdg, EOkN2pRjFsg and others): fine
  photographs, but the setting misplaces a US-only product.
- **magnific.com**: not used and not to be used. It is an AI image generator
  and upscaler, so its output is exactly the synthetic look this page is meant
  to avoid, and its assets are not licensable for a product sold to corporate
  clients.

## Adding a new image

1. Confirm the photo is on Unsplash under the free Unsplash Licence, not
   Unsplash+.
2. Prefer a pre-2023 upload. If a later one is unavoidable, inspect it at full
   resolution and say in this file why you are confident it is a photograph.
3. Crop and encode to the smallest dimensions that cover the rendered size.
4. Add a full entry here (source URL, photographer, licence, publish date,
   download date, dimensions, subject, reason) before merging.
5. Write alt text that describes what is in the photograph.
