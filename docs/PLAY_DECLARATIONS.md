# Google Play Console declarations (copy-paste answers)

Two declarations gate Taxottic's Android releases. Both live in Play
Console → App content. Complete BEFORE submitting the release that
carries the walk-away drive-end feature (ACTIVITY_RECOGNITION).

## 1. Foreground service (location) — FGS declaration

**Where:** App content → Foreground service permissions.
**Type to declare:** `location`

**Use-case description (paste):**
> Taxottic automatically tracks business mileage for tax deductions. A
> location foreground service records the user's route during drives so
> each trip's distance and IRS deduction are computed accurately. The
> service runs only while the user has enabled automatic mileage
> tracking, shows a persistent notification while active, and stops when
> tracking is turned off.

**Video:** screen-record a drive start on a device: enable the Mileage
auto-track toggle → show the persistent "Taxottic" notification in the
shade → (after a short drive) show the trip appearing on the Mileage
map. Upload unlisted to YouTube and paste the link.

## 2. Health apps declaration (ACTIVITY_RECOGNITION)

**Where:** App content → Health apps.
**Triggered by:** `android.permission.ACTIVITY_RECOGNITION` (step
counter powering walk-away drive-end detection).

**Category:** NOT a health/fitness app — declare the permission's use
as a non-health feature.

**Use-case description (paste):**
> Taxottic is a tax and mileage tracking app, not a health or fitness
> product. The activity-recognition (step count) signal is used solely
> to detect that a drive has ended: when the vehicle stops moving and
> the user walks away from the car, the app closes the mileage trip
> promptly and accurately. Step data is read momentarily on-device for
> this comparison, is never stored, displayed, shared, or used for any
> health, fitness, or wellness purpose.

**Data-safety follow-through:** in Data safety, "Physical activity" data
is collected = NO stored/shared (processed ephemerally on device). If
the form forces a "collected" answer for ephemeral use, mark: collected,
not shared, processed ephemerally, required for app functionality.

## Sequencing note
The 1.2.0 production release (in review now) does NOT carry
ACTIVITY_RECOGNITION — only the next cut (1.3.0, walk-away feature)
does. The Health declaration must be completed before 1.3.0 is
submitted; the FGS declaration should already be in place (required
since API 34) — verify it is, since the iOS-side pipeline masked
failures before and this one may never have been filed.
