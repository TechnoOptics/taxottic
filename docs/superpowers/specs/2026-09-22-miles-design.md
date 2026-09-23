# Miles: the drive log you can read on a phone

## 1. Brief

The owner's words, after using it on his own phone: the Miles section is "messy
and not user friendly", it "does not show and is slow to load drives", it does
not "react when you click today or this month", and it "has too many words in
some sections".

All four reproduce. This spec fixes the causes rather than the appearance.

`/mileage` became a primary destination when #635 shipped the phone tab bar,
where Drives is one of five tabs. The Year grammar spec
(`2026-09-05-year-interface-design.md`) covered the marketing home, the
secondary marketing pages, Today and the tab bar, and never covered this
screen. It is the last surface a driver touches daily that the grammar has not
reached.

## 2. What is actually wrong

Measured on 2026-09-22 against `main` at b86e68e, by rendering the real
components at 390px and reading the page source.

**It opens on a window that is usually empty.** `app/mileage/page.tsx:96`
defaults `range` to `day`. Android's median GPS fix reaches the server 24 hours
after capture, with p90 at 5.9 days, so "Today" is the one window most likely
to hold nothing. The screen is behaving correctly and showing you a blank.

**It fetches map thumbnails before it renders anything.** Lines 361 to 388 call
the `mileage_trip_polylines` RPC for every trip in the range at up to 250 points
each, then page the result in 1000-row chunks in a loop bounded at 60,000 rows.
That is up to sixty sequential database round trips, awaited in full, on a
`force-dynamic` page with no `Suspense` and no `loading.tsx`, for thumbnails on
rows the reader may never scroll to. This is the wait, not the dynamic
rendering.

**The range pills are links.** Lines 692 to 710 render each range as a plain
`<Link href="/mileage?range=...">`. With no pending state and no streaming
boundary, a tap starts a full server render and nothing on screen changes until
it returns. That is the "does not react" complaint exactly.

**The head is all chrome.** Before the first drive: a breadcrumb, a two-line
title, a company line, a tracking-health alert, a driver selector, a Team view
row, a "3 drives need a quick call" card, then eight pills wrapping onto three
rows in five visual treatments, mixing the time filter with navigation to Saved
places and Schedule. Every pill measures 32px against the 44px floor, and the
head carries four arrows.

**The classification is asked for three times.** `TripList.tsx` already gives
each row a segmented business or personal control backed by a server action.
The orange card and the orange pill above it ask for the same thing again.

**Three strings run past 170 characters.** `TeamTrackingHealth.tsx:109,112,115`
at 171, 213 and 157, and `app/mileage/page.tsx:606` at 195.

## 3. Decisions the owner made

1. **No default window.** The page opens on the newest drives whenever they
   happened, newest first, grouped by day. The ranges become a filter reached
   for, not a gate landed behind.
2. **Manager controls collapse to one line.** Whose log you are reading, the
   switch, and a quiet marker when a phone is not tracking. The detail opens
   only when something is wrong.
3. **Classification lives in the rows.** The card and the pill both go. A quiet
   count near the total says how many drives wait and scrolls to the first.
4. **Architecture C.** Server renders the newest drives; filters run in the
   browser; only "load older" touches the network.

## 4. The design

### 4.1 Data flow

**First paint is the drives.** The server query returns the newest `PAGE_SIZE`
drives for the viewer (or the selected driver), ordered by `started_at`
descending, with no polylines. Everything the head needs that is not a drive
(the awaiting-decision count, tracking health, the driver list) either already
runs as a cheap indexed read or moves behind a `Suspense` boundary so it cannot
delay the list.

**Thumbnails arrive after the list.** The polyline loop leaves the page render
path. Each row requests its own polyline through a route handler when it comes
near the viewport, via an `IntersectionObserver`. A row with no polyline yet
shows its distance, times and places, which is the information a reader uses.
`mileage_trip_polylines` keeps its current signature and is called with one
trip id, so no PostgREST paging is needed and the 60,000-row loop is deleted.

**Filters are local.** The range control filters the drives already in memory
by `started_at`. No navigation, no query string round trip, no pending state
needed because nothing is pending. The control names what it is showing ("last
30 days, 12 drives"). When a filter's window extends past the oldest loaded
drive, the control says so and offers to load older rather than implying the
list is complete.

**Older drives load on demand.** One button at the end of the list fetches the
next page through the same route handler and appends. This is the only network
call the screen makes after first paint.

### 4.2 The screen

Top to bottom on a phone:

1. **One identity line.** "Your drives", or the driver's name with a switch
   when the viewer is a manager. A tracking marker sits on this line only when
   a phone needs attention, and opens the existing detail.
2. **The total.** Miles and deduction for what is currently shown, in the data
   face (`.figure`), with the count of drives. When drives await a decision, a
   quiet `mono-label` count sits beside it and scrolls to the first.
3. **The filter.** One control, Year grammar, 44px, no chips and no arrows.
4. **The drives**, grouped by day as `groupTrips` already groups them.
5. **Everything else below the list**: saved places, schedule, business
   breadcrumbs, the add-by-hand path, the auto-track toggle.

### 4.3 Copy

Each of the four strings over 170 characters becomes one sentence that says the
thing and stops. The `TeamTrackingHealth` explanations keep the cause and drop
the tutorial: "Silent" says the phone stopped uploading and names the usual
reason; the Settings path moves into the recovery control that performs it. The
auto-track description says tracking runs in the mobile app, and the web
alternative moves to the manual-add control it describes.

No retired register words, no em dashes, no arrows in link text, per the Year
grammar's copy rules.

### 4.4 Scope of the file changes

`app/mileage/page.tsx` is 958 lines and does routing, six data loads, the head,
the stats, the list and four secondary sections. This spec does not rewrite it
wholesale. It extracts exactly what the change needs:

- `lib/mileage/drive-page.ts`: the drive query and the page-size contract, so
  the route handler and the page cannot drift.
- `components/mileage/DriveFilter.tsx`: the local filter control and its state.
- `components/mileage/DriveThumbnail.tsx`: the lazy polyline request.
- `app/api/mileage/drives/route.ts`: older pages and single-trip polylines.
- `app/mileage/loading.tsx`: the skeleton that first paint shows.

The head's collapse happens in place in `page.tsx`, which shrinks it rather
than growing it.

## 5. Out of scope

- The firm view (`app/firm/mileage`) and the business summary
  (`/mileage/business`). They read the same data and keep their current chrome.
- The classification rules, the finalizer, and anything about how drives are
  detected or closed. This is the reading surface only.
- The upload latency itself, which PR 5 addresses natively and which this
  design assumes will stay imperfect.
- Dark theme work beyond keeping what exists correct in both themes.

## 6. How we will know it worked

- Opening Miles on a phone that has not driven today shows drives.
- Tapping a filter changes the list within one frame, with no network request.
- First byte does not wait on any polyline.
- No string on the screen exceeds 170 characters.
- Every control the thumb reaches is at least 44px.
- The three questions the old head asked about classification are asked once,
  on the row.

## 7. Guards this design adds

- A source guard that `app/mileage/page.tsx` contains no `mileage_trip_polylines`
  call and no paging loop over it, so the blocking fetch cannot return.
- A source guard that the range control is not a `<Link>` and carries no
  `?range=` href, so the filter cannot silently become a navigation again.
- A test that the page's default query applies no date floor.
- A rendered component test at 390px asserting: one identity line, every
  control at least 44px, no `rounded-full`, no arrow glyphs, and no string
  over 170 characters.
- A test that a row with no polyline still renders its distance, times and
  places, so a failed thumbnail never costs the reader the drive.
