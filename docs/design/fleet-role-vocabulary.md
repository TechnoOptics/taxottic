# Taxottic: `role` vocabulary, for the Hub operator

**To:** the Hub operator, Techno Optics
**From:** the Taxottic team
**Re:** `INTEGRATION.md` revision C, section 4.1a
**Date prepared:** 22 August 2026

This is the written exchange section 4.1a asks for, in the order it asks for
it. It is not an endpoint, and no vocabulary endpoint exists or will be built.

Steps 1 to 3 below need nothing from you and are complete. Steps 4 and 5 are
open: step 4 is yours, and step 5 is ours once step 4 arrives.

---

## Step 1. The exact set of `role` values this product accepts

Read from the single place in the schema that defines them, the Postgres enum
`public.company_role` on project `enisnjjbxqaliydepacc`, not from memory:

```
manager
member
lead
expenser
```

Four values, lower case, no spaces, no punctuation, in the enum's own sort
order. Those are the literal strings. Send one of them exactly as written.

The contract's own example values are `admin`, `manager` and `viewer`.
**`manager` is the only one of the three this product has.** Section 4.1
already says the three examples "are an illustration of the field's shape and
not a vocabulary any product is expected to have", so this is expected rather
than a problem, but it is worth stating plainly: `admin` and `viewer` are not
values here and would each be a `422`.

There is a second role enum in this product, `public.firm_role`
(`owner`, `manager`, `preparer`, `reviewer`). **It is not the vocabulary for
this field.** It describes staff inside an accounting practice, which is a
different kind of tenant from the one a prospect is provisioned into. A
sandbox prospect is provisioned into a company, so `company_role` is the set.
It is mentioned only so that nobody later finds it and assumes it was omitted
by accident.

## Step 2. The value we recommend for a sandbox prospect, and what it can do

**`manager`.**

One line, as asked: a manager holds full rights inside their own company,
including the forecast, income and expenses, the team roster, invitations and
company settings, which is the whole of what a prospect needs in order to
evaluate the product without hitting a permission wall.

The other three, so that you are choosing a permission level rather than a
string:

| Value | What it can do |
|---|---|
| `manager` | Everything inside its own company: forecast, income, expenses, mileage, roster, invitations, company settings. **Recommended.** |
| `lead` | A department lead. Manager-like expense review and forecast visibility, scoped to their own department only. No invitations, no company settings. |
| `member` | An ordinary employee. Their own expenses and mileage, plus the parts of the company view their plan allows. |
| `expenser` | The narrowest role. Log their own expenses and mileage, and use chat. No forecast, no income, no roster, no company settings. |

A prospect provisioned as `expenser` would see an evaluation of a product that
does almost nothing, and would have no way to tell that from the product
itself. That would be a section 6.6 failure as much as a permissions one.

## Step 3. What we do with a value we do not recognize

**`422`, with no mapping and no default.**

Section 4.1 requires that, and section 4.1a step 3 requires us to confirm it
back rather than assume it, so: a `role` that is not one of the four literal
strings in step 1 is rejected with a `422` and the error body shape in section
9. We will not map an unknown value onto `member`, onto `manager`, or onto
anything else.

The reason 4.1a gives is the reason we agree with: "a silent map is how a
prospect ends up with a permission level nobody chose". A `422` on the first
call is a bad afternoon. A silent map is a prospect who has been quietly given
either less product than they were promised or more access than anyone
intended, on nine products, with nothing in any log to say so.

## Step 4. Yours: confirm the value in writing

Please configure one value for Taxottic and confirm it back to us in writing,
as the literal string the Hub will send. That confirmation is open question 10,
and it is one of the four that block work here.

We are not filling it in with a local decision. Section 0 and section 13 are
both explicit that a local answer to a `[VERIFY]` item is how two products in
the fleet end up behaving differently, and the recommendation in step 2 is a
recommendation, not an assumption about what you will send.

## Step 5. Ours, once step 4 arrives: assert the exact string in a test

Section 4.1a step 5 asks us to assert the confirmed string in a test, "so a
later change to your own role vocabulary that drops or renames it fails your
build rather than the Hub's next call".

The half we can do without your answer is already done.
`lib/hq/role-vocabulary.test.ts` asserts all four literal strings against the
migration that declares the enum and against the type in `lib/auth.ts`, so a
migration that renames or drops any of them fails CI today. The named seam in
that file is a single constant, `HUB_CONFIGURED_ROLE`, currently `null`. When
your confirmation arrives it becomes the literal string you sent, and the test
tightens from "the vocabulary is intact" to "the exact value the Hub sends is
still in it".

---

## What is deliberately not in this document

- **No mapping to any Hub role.** Nothing in the contract describes a Hub-side
  role vocabulary, and inventing a correspondence to one would be exactly the
  local decision section 0 tells us not to take.
- **No suggestion that you send `admin`.** Section 4.1 tells us not to add the
  example values to match the example, so we have not added them.
- **No endpoint.** 4.1a: "This is a written exchange, not an endpoint. There is
  no vocabulary endpoint, and you must not build one."
