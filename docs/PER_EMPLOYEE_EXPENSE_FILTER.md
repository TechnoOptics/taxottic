# Per-employee expense filter

**Status:** Draft — awaiting user sign-off before implementation
**Tracks:** Task #56

A multi-member company has multiple users logging expenses, income, and
mileage. Today every list shows the **combined** roll-up for the
company. Managers and members both need to see *who* added *what* so
they can sanity-check, reimburse, or split per-employee deductibles.

## The data already has 3 of 4 owners

Schema audit (May 21, 2026):

| Table | User attribution |
|---|---|
| `monthly_expenses` | ✅ `user_id` |
| `monthly_income` | ✅ `user_id` |
| `mileage_trips` | ✅ `driver_user_id` |
| `bank_transactions` | ❌ company-level only |

Bank rows are imported in bulk per Plaid/Stripe account so they don't
have a natural "employee owner." Treat them as company-shared and
don't expose a per-employee filter on the Banks page; the filter is
for **expenses**, **income**, and **mileage** only.

## Surface: dropdown above each list

Every list page (`/c/<id>/expenses`, `/c/<id>/income`, the existing
mileage views) grows a dropdown next to its existing range/month
controls:

```
[ Show: All ▾ ]   This week  This month  Quarter  YTD
```

`All ▾` expands to:

```
Show
─────────────────────
• All employees       ← default
• Me (Abel Ark)
─────────────────────
• Bria Walker
• Carlos Mendez
• Other employee…
```

The "All" option is the current behavior. "Me" shows only rows the
signed-in user owns. The named entries below are every other member
of the company.

State persists in the URL as `?driver=<userId>` (mileage) or
`?owner=<userId>` (expenses/income) so a manager can deep-link a
report to a specific employee and the back button works the way users
expect.

## Permissions

The filter is **not a security boundary** — every member of the
company already sees every row via the existing RLS policy. The
filter is a UI convenience. That means no migration to RLS, no new
auth code: the server action just adds `.eq("user_id", filterUid)`
when the filter is set.

Two rules to keep the UX honest:

1. **Members default to "All".** Showing "Me only" by default could
   hide a row a member added under their old account, or hide rows
   that look like duplicates because they don't see the other
   employee's entries. Default-all matches what they see today.
2. **Managers can filter to any employee. Members can filter to
   "All" or "Me" only.** Members see other employees' aggregate
   data (because they always have) but can't pick a single other
   employee to scrutinize. (Open question — should members get the
   full picker?)

## Server work

- `app/c/[publicId]/expenses/page.tsx`, `income/page.tsx`,
  `mileage/page.tsx`, `mileage/business/page.tsx`:
  - Accept `?owner=<userId>` (or `?driver=…`) search param
  - Validate the param is a member of this company (if not, ignore
    silently — never return an error)
  - Pass it through to the Supabase query as `.eq("user_id", uid)`
  - Compute the totals/forecast on the filtered set so the YTD card
    above reflects the active filter

- New component `<EmployeePicker companyId={...} value={...} />`
  - Reads `company_members` joined to `profiles` for names
  - Renders the dropdown with Me / All / each other member
  - On change, pushes the URL with the new param

## Out of scope (this PR)

- Manager-only deductibility decisions (e.g., approving an
  expense flagged by an employee) — that's a workflow, this is
  filter-only
- Reimbursement tracking — the rows aren't "owed to" anyone yet
- Bank transactions filtering — see "data already has" above
- Reporting / exporting filtered slices — separate task

## Test plan

Once shipped:

- [ ] Sign in as a manager of a company with two members → expenses
      page → filter to "Bria" → only Bria's rows are listed, YTD
      total reflects only Bria's rows
- [ ] Same flow but as a member → only "All" + "Me" appear in the
      dropdown
- [ ] Deep-link `/c/<id>/expenses?owner=<userId>` directly → page
      loads with the filter pre-applied
- [ ] Pass an invalid `?owner=…` → page loads as "All" (no error)
- [ ] Bank transactions page has NO filter (sanity-check, since the
      table has no owner column)

## Open questions for the user

1. **Members vs. managers — full picker or not?** My default is
   members can only filter All/Me, managers can pick any employee.
   Confirm or override.
2. **Show employee names or just emails?** Profile has both.
   Default to `full_name` falling back to `email`.
3. **Should we also show the owner on each row in the list?**
   Today rows don't display who added them — even with the filter,
   you'd see "$60" but not "added by Bria". I'd add a tiny `· Bria`
   suffix on each row, but flagging.

## Implementation order (small commits)

1. EmployeePicker component (no wiring yet)
2. /expenses page wires the picker + ?owner param
3. /income page repeats the pattern
4. /mileage + /mileage/business repeat with ?driver param
5. Tiny "added by …" row caption (open question #3)

Each commit ships independently green so we can pause anywhere if
something else takes priority.
