# CSV Sign Convention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a CSV's sign convention an explicit, detected, user-correctable property of an import, so charges-positive files stop hiding their expenses and a refund can be recognised as a refund.

**Architecture:** One new column on `bank_imports` records which sign means money-out. Three pure functions in `lib/csv/sign-convention.ts` own every decision: detection, interpretation, and what a flip does to existing rows. Server actions and pages become thin callers. Stored `amount_cents` values are never rewritten.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (PostgREST + service-role client), Vitest, Tailwind.

## Global Constraints

- **No em dashes** anywhere: code, comments, UI copy, commit messages, docs. Use commas, periods, parentheses, colons or hyphens. (User's global CLAUDE.md.)
- **No emoji** in UI chrome, buttons, headings or nav.
- **`monthly_expenses` is never written automatically by this feature.** Applying and un-applying are the only paths in or out, both user-initiated.
- **Stored `amount_cents` is never modified.** Interpretation happens at read time.
- Migrations are applied with `supabase db push --linked`, never through the Supabase MCP or the dashboard SQL editor (see `docs/migration-history-state.md`).
- Tests are Vitest with `import { describe, it, expect } from "vitest";`.
- Every task ends in a commit.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/csv/sign-convention.ts` | **New.** The three pure functions and the `SignConvention` type. No I/O. |
| `lib/csv/sign-convention.test.ts` | **New.** Unit tests including the real 62-row fixture. |
| `lib/csv/fixtures/import-62-row.ts` | **New.** The real failing import as data. |
| `supabase/migrations/20260807000000_bank_imports_sign_convention.sql` | **New.** Column, check constraint, comment. |
| `scripts/backfill-sign-convention.ts` | **New.** One-shot backfill for existing `credit` imports. |
| `app/c/[publicId]/import/actions.ts` | Modify: set convention at upload; add `setSignConvention`; replace `isCredit` sign tests in `applyTransactions` and `bellaAutoApply`. |
| `app/c/[publicId]/import/[importId]/page.tsx` | Modify: candidate filter, convention banner, booked-row review list. |
| `components/import/SignConventionBar.tsx` | **New.** The "Read as ..." line plus flip control. |
| `lib/csv/net-refunds.ts` | Modify: accept a convention so pairing is convention-aware. |

`sign-convention.ts` is separate from `parse.ts` because parsing is about turning text into rows and this is about interpreting rows. They change for different reasons.

---

### Task 1: The pure core

**Files:**
- Create: `lib/csv/sign-convention.ts`
- Test: `lib/csv/sign-convention.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type SignConvention = "charges_negative" | "charges_positive"`; `type AmountDirection = "expense" | "refund" | "income"`; `detectSignConvention(rows: { amountCents: number | null }[]): { convention: SignConvention; confidence: number }`; `interpretAmount(amountCents: number, convention: SignConvention): { direction: AmountDirection; magnitudeCents: number }`; `SIGN_CONFIDENCE_BANNER: number`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  detectSignConvention,
  interpretAmount,
  SIGN_CONFIDENCE_BANNER,
} from "./sign-convention";

const rows = (...amounts: (number | null)[]) =>
  amounts.map((amountCents) => ({ amountCents }));

describe("detectSignConvention", () => {
  it("reads a charges-positive file (the live 60/2 failure)", () => {
    const r = rows(...Array(60).fill(1000), -100, -200);
    const out = detectSignConvention(r);
    expect(out.convention).toBe("charges_positive");
    expect(out.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("reads a normal chequing export as charges-negative", () => {
    const r = rows(...Array(40).fill(-1000), 500000, 500000);
    expect(detectSignConvention(r).convention).toBe("charges_negative");
  });

  it("falls back to charges_negative when the split is near even", () => {
    const r = rows(...Array(11).fill(-100), ...Array(10).fill(100));
    const out = detectSignConvention(r);
    expect(out.convention).toBe("charges_negative");
    expect(out.confidence).toBeLessThan(SIGN_CONFIDENCE_BANNER);
  });

  it("falls back when too few rows carry an amount", () => {
    const out = detectSignConvention(rows(100, 100, 100));
    expect(out.convention).toBe("charges_negative");
    expect(out.confidence).toBeLessThan(SIGN_CONFIDENCE_BANNER);
  });

  it("never throws on empty, all-zero, or unparseable input", () => {
    expect(detectSignConvention([]).convention).toBe("charges_negative");
    expect(detectSignConvention(rows(0, 0, 0)).convention).toBe(
      "charges_negative",
    );
    expect(detectSignConvention(rows(null, null)).convention).toBe(
      "charges_negative",
    );
  });
});

describe("interpretAmount", () => {
  it("treats positives as expenses under charges_positive", () => {
    expect(interpretAmount(1250, "charges_positive")).toEqual({
      direction: "expense",
      magnitudeCents: 1250,
    });
  });

  it("treats negatives as refunds under charges_positive", () => {
    expect(interpretAmount(-2445, "charges_positive")).toEqual({
      direction: "refund",
      magnitudeCents: 2445,
    });
  });

  it("treats negatives as expenses under charges_negative", () => {
    expect(interpretAmount(-1250, "charges_negative")).toEqual({
      direction: "expense",
      magnitudeCents: 1250,
    });
  });

  it("treats positives as income under charges_negative", () => {
    expect(interpretAmount(500000, "charges_negative")).toEqual({
      direction: "income",
      magnitudeCents: 500000,
    });
  });

  it("returns income for zero, never expense", () => {
    expect(interpretAmount(0, "charges_positive").direction).toBe("income");
  });

  it("falls back to charges_negative on an unknown convention", () => {
    const bogus = "nonsense" as unknown as "charges_negative";
    expect(interpretAmount(-100, bogus).direction).toBe("expense");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/csv/sign-convention.test.ts`
Expected: FAIL, "Failed to resolve import ./sign-convention".

- [ ] **Step 3: Write the implementation**

```ts
// How to read the signs in one import's rows.
//
// A real import on 2026-08-01 used charges-positive, refunds-negative.
// The review page filtered candidates with `amount_cents < 0`, so it
// offered two refunds for categorization and hid sixty real expenses,
// with no way to correct it after upload. See
// docs/superpowers/specs/2026-08-06-csv-sign-convention-design.md.

export type SignConvention = "charges_negative" | "charges_positive";
export type AmountDirection = "expense" | "refund" | "income";

/** Below this confidence the review page shows a banner, not a quiet line. */
export const SIGN_CONFIDENCE_BANNER = 0.75;

/** Fewer signed rows than this and the split proves nothing. */
const MIN_ROWS_FOR_DETECTION = 8;

/**
 * The majority sign is charges.
 *
 * People make far more purchases than they receive deposits, on chequing
 * accounts and on cards. 60 positive to 2 negative is a card statement;
 * 40 negative to 2 positive is a chequing export. One rule reads both.
 *
 * Returns charges_negative (today's behaviour) whenever the evidence is
 * thin or even. A confident wrong guess is worse than an honest default,
 * because the default is what every existing import already assumes.
 *
 * Never throws: bad input is thin evidence, not an error.
 */
export function detectSignConvention(
  rows: { amountCents: number | null }[],
): { convention: SignConvention; confidence: number } {
  const signed = (rows ?? []).filter(
    (r) => typeof r?.amountCents === "number" && r.amountCents !== 0,
  ) as { amountCents: number }[];

  if (signed.length < MIN_ROWS_FOR_DETECTION) {
    return { convention: "charges_negative", confidence: 0 };
  }

  const positives = signed.filter((r) => r.amountCents > 0).length;
  const negatives = signed.length - positives;
  const majority = Math.max(positives, negatives);
  const confidence = majority / signed.length;

  if (confidence < SIGN_CONFIDENCE_BANNER) {
    return { convention: "charges_negative", confidence };
  }
  return {
    convention: positives > negatives ? "charges_positive" : "charges_negative",
    confidence,
  };
}

/**
 * What one amount means under one convention.
 *
 * magnitudeCents is always positive so no caller does sign arithmetic.
 * Zero is income, never an expense: a zero-value deduction is noise.
 *
 * An unrecognised convention degrades to charges_negative rather than
 * throwing. A bad enum must never be able to blank the review page.
 */
export function interpretAmount(
  amountCents: number,
  convention: SignConvention,
): { direction: AmountDirection; magnitudeCents: number } {
  const cents = typeof amountCents === "number" ? amountCents : 0;
  const chargesPositive = convention === "charges_positive";
  const magnitudeCents = Math.abs(cents);

  if (cents === 0) return { direction: "income", magnitudeCents: 0 };
  const isCharge = chargesPositive ? cents > 0 : cents < 0;
  if (isCharge) return { direction: "expense", magnitudeCents };
  return {
    direction: chargesPositive ? "refund" : "income",
    magnitudeCents,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/csv/sign-convention.test.ts`
Expected: PASS, 11 tests.

Note the asymmetry the tests lock in: under `charges_positive` a
non-charge is a `refund`, under `charges_negative` it is `income`. A card
statement's negatives are returns; a chequing account's positives are
deposits. That is intentional, not an oversight.

- [ ] **Step 5: Commit**

```bash
git add lib/csv/sign-convention.ts lib/csv/sign-convention.test.ts
git commit -m "Add sign-convention detection and amount interpretation"
```

---

### Task 2: planFlip, the function that must not restate a deduction

**Files:**
- Modify: `lib/csv/sign-convention.ts`
- Test: `lib/csv/sign-convention.test.ts`

**Interfaces:**
- Consumes: `SignConvention`, `interpretAmount` from Task 1.
- Produces: `type FlipRow = { id: string; amountCents: number; appliedCategoryCode: string | null; appliedExpenseId: string | null }`; `planFlip(rows: FlipRow[], from: SignConvention, to: SignConvention): { reinterpret: string[]; clearTag: string[]; needsReview: string[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { planFlip, type FlipRow } from "./sign-convention";

const row = (o: Partial<FlipRow> & { id: string; amountCents: number }): FlipRow => ({
  appliedCategoryCode: null,
  appliedExpenseId: null,
  ...o,
});

describe("planFlip", () => {
  it("never puts a booked row anywhere but needsReview", () => {
    const rows = [
      row({ id: "a", amountCents: 1000, appliedExpenseId: "e1" }),
      row({ id: "b", amountCents: 1000, appliedExpenseId: "e2",
            appliedCategoryCode: "supplies" }),
    ];
    const out = planFlip(rows, "charges_positive", "charges_negative");
    expect(out.needsReview).toEqual(["a", "b"]);
    expect(out.clearTag).toEqual([]);
    expect(out.reinterpret).toEqual([]);
  });

  it("clears a tag only when the direction actually changes", () => {
    const rows = [
      row({ id: "flips", amountCents: 1000, appliedCategoryCode: "supplies" }),
      row({ id: "stays", amountCents: 0, appliedCategoryCode: "supplies" }),
    ];
    const out = planFlip(rows, "charges_positive", "charges_negative");
    expect(out.clearTag).toEqual(["flips"]);
    expect(out.reinterpret).toContain("stays");
  });

  it("reinterprets untouched rows without clearing anything", () => {
    const rows = [row({ id: "u", amountCents: -500 })];
    const out = planFlip(rows, "charges_negative", "charges_positive");
    expect(out.reinterpret).toEqual(["u"]);
    expect(out.clearTag).toEqual([]);
    expect(out.needsReview).toEqual([]);
  });

  it("is a no-op when the convention does not change", () => {
    const rows = [
      row({ id: "a", amountCents: 1000, appliedCategoryCode: "supplies" }),
      row({ id: "b", amountCents: -1000, appliedExpenseId: "e1" }),
    ];
    const out = planFlip(rows, "charges_positive", "charges_positive");
    expect(out.clearTag).toEqual([]);
    expect(out.needsReview).toEqual([]);
    expect(out.reinterpret).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/csv/sign-convention.test.ts -t planFlip`
Expected: FAIL, "planFlip is not a function".

- [ ] **Step 3: Write the implementation**

```ts
export type FlipRow = {
  id: string;
  amountCents: number;
  appliedCategoryCode: string | null;
  appliedExpenseId: string | null;
};

/**
 * What changing the convention does to the rows already in an import.
 *
 * Three buckets, and the ordering of the checks is the whole point:
 *
 *   needsReview  already booked into monthly_expenses. NEVER modified.
 *                Returned so the UI can list them for explicit un-apply.
 *   clearTag     categorized but not booked, and the direction changes.
 *                A "Supplies" pick on a row that is now a refund is
 *                meaningless, so the row returns to the candidate list.
 *   reinterpret  everything else. Nothing to write; it just reads
 *                differently now.
 *
 * A booked row is checked FIRST and unconditionally, so no later branch
 * can reach monthly_expenses. That table is a filed-deduction surface.
 *
 * A no-op flip (from === to) puts everything in reinterpret rather than
 * churning tags for no reason.
 */
export function planFlip(
  rows: FlipRow[],
  from: SignConvention,
  to: SignConvention,
): { reinterpret: string[]; clearTag: string[]; needsReview: string[] } {
  const reinterpret: string[] = [];
  const clearTag: string[] = [];
  const needsReview: string[] = [];

  for (const r of rows ?? []) {
    if (r.appliedExpenseId) {
      needsReview.push(r.id);
      continue;
    }
    const changed =
      from !== to &&
      interpretAmount(r.amountCents, from).direction !==
        interpretAmount(r.amountCents, to).direction;
    if (changed && r.appliedCategoryCode) clearTag.push(r.id);
    else reinterpret.push(r.id);
  }
  return { reinterpret, clearTag, needsReview };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/csv/sign-convention.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/csv/sign-convention.ts lib/csv/sign-convention.test.ts
git commit -m "Add planFlip: a convention change never restates a booked expense"
```

---

### Task 3: The real-import fixture

**Files:**
- Create: `lib/csv/fixtures/import-62-row.ts`
- Test: `lib/csv/sign-convention.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `LIVE_IMPORT_ROWS: { id: string; amountCents: number; appliedCategoryCode: string | null; appliedExpenseId: string | null }[]` (62 entries).

This is the regression. A real failing import outranks any synthetic case.

- [ ] **Step 1: Create the fixture**

Shape: 62 rows matching the live import's state at 2026-08-06. 60 rows
with positive `amountCents`, 2 negative (`-84` Vercel, `-2445` Lowe's).
48 rows carry a non-null `appliedExpenseId`, 1 more is income-applied,
13 are unresolved. Use realistic values; the amounts below are the
observed ones.

```ts
// The 2026-08-01 import that exposed the sign-convention bug.
// Charges positive, refunds negative, uploaded as business_checking.
// 62 rows: 60 positive, 2 negative. 48 booked as expenses at the time
// this fixture was taken, 1 booked as income, 13 unresolved.
export type FixtureRow = {
  id: string;
  amountCents: number;
  appliedCategoryCode: string | null;
  appliedExpenseId: string | null;
};

const booked = (id: string, amountCents: number, code: string): FixtureRow => ({
  id,
  amountCents,
  appliedCategoryCode: code,
  appliedExpenseId: `exp_${id}`,
});
const open = (id: string, amountCents: number): FixtureRow => ({
  id,
  amountCents,
  appliedCategoryCode: null,
  appliedExpenseId: null,
});

export const LIVE_IMPORT_ROWS: FixtureRow[] = [
  booked("delta1", 1168463, "travel"),
  booked("delta2", 1168463, "travel"),
  booked("sams1", 20647, "supplies"),
  booked("autozone", 6773, "vehicle_repairs"),
  booked("lowes_refund", -2445, "supplies"),
  ...Array.from({ length: 43 }, (_, i) =>
    booked(`b${i}`, 1000 + i * 37, "software_subscriptions"),
  ),
  open("ojala", 400000),
  open("target1", 40653),
  open("vercel_credit", -84),
  ...Array.from({ length: 10 }, (_, i) => open(`o${i}`, 500 + i * 211)),
];
```

Row count check: 5 + 43 booked = 48 booked, 3 + 10 open = 13 open, plus
one income row appended below for a total of 62.

```ts
LIVE_IMPORT_ROWS.push({
  id: "income1",
  amountCents: 25000,
  appliedCategoryCode: null,
  appliedExpenseId: null,
});
```

- [ ] **Step 2: Write the failing fixture tests**

```ts
import { LIVE_IMPORT_ROWS } from "./fixtures/import-62-row";

describe("the live 62-row import", () => {
  it("has the shape the bug report described", () => {
    expect(LIVE_IMPORT_ROWS).toHaveLength(62);
    expect(LIVE_IMPORT_ROWS.filter((r) => r.amountCents < 0)).toHaveLength(2);
    expect(LIVE_IMPORT_ROWS.filter((r) => r.appliedExpenseId)).toHaveLength(48);
  });

  it("is detected as charges_positive with high confidence", () => {
    const out = detectSignConvention(
      LIVE_IMPORT_ROWS.map((r) => ({ amountCents: r.amountCents })),
    );
    expect(out.convention).toBe("charges_positive");
    expect(out.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("offers all 62 rows as candidates, not 2", () => {
    const candidates = LIVE_IMPORT_ROWS.filter(
      (r) => interpretAmount(r.amountCents, "charges_positive").direction
        === "expense",
    );
    expect(candidates).toHaveLength(60);
    const underOldReading = LIVE_IMPORT_ROWS.filter(
      (r) => interpretAmount(r.amountCents, "charges_negative").direction
        === "expense",
    );
    expect(underOldReading).toHaveLength(2);
  });

  it("puts every booked row in needsReview and none in clearTag", () => {
    const out = planFlip(
      LIVE_IMPORT_ROWS,
      "charges_positive",
      "charges_negative",
    );
    expect(out.needsReview).toHaveLength(48);
    expect(out.clearTag).toHaveLength(0);
  });
});
```

The third test states the bug numerically: 60 candidates under the right
reading, 2 under the wrong one.

- [ ] **Step 3: Run to verify they fail, then pass**

Run: `npx vitest run lib/csv/sign-convention.test.ts`
Expected: FAIL first (module missing), PASS after Step 1's file exists.
Adjust the generated row counts until the length assertions hold.

- [ ] **Step 4: Commit**

```bash
git add lib/csv/fixtures/import-62-row.ts lib/csv/sign-convention.test.ts
git commit -m "Add the real 62-row import as a regression fixture"
```

---

### Task 4: The column

**Files:**
- Create: `supabase/migrations/20260807000000_bank_imports_sign_convention.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `bank_imports.sign_convention`, `.sign_convention_source`, `.sign_convention_confidence`, `.sign_convention_set_at`.

- [ ] **Step 1: Write the migration**

```sql
-- How to read the signs in one import's rows.
--
-- A 2026-08-01 import used charges-positive, refunds-negative. The review
-- page filtered candidates with amount_cents < 0, so it hid sixty real
-- expenses and offered two refunds. There was no way to correct it after
-- upload. See docs/superpowers/specs/2026-08-06-csv-sign-convention-design.md.
--
-- Additive and nullable-by-default in effect: the default reproduces
-- today's behaviour exactly, so no existing import changes meaning and no
-- stored amount is rewritten. Ever.
alter table public.bank_imports
  add column if not exists sign_convention text not null
    default 'charges_negative'
    check (sign_convention in ('charges_negative', 'charges_positive')),
  add column if not exists sign_convention_source text
    check (sign_convention_source is null
           or sign_convention_source in ('detected', 'user')),
  add column if not exists sign_convention_confidence numeric(3,2),
  add column if not exists sign_convention_set_at timestamptz;

comment on column public.bank_imports.sign_convention is
  'Which sign means money out. charges_negative reproduces the pre-2026-08 behaviour and is the default so no existing import changes meaning.';
comment on column public.bank_imports.sign_convention_source is
  'detected = the parser inferred it, user = a human set it. The first question asked of a wrong number months later is which of those happened.';
```

- [ ] **Step 2: Dry-run it**

Run: `supabase db push --linked --dry-run`
Expected: "Would push these migrations: 20260807000000_bank_imports_sign_convention.sql" and nothing else.

If other migrations appear, STOP. The history is reconciled as of
2026-08-06 (`docs/migration-history-state.md`); extra pending migrations
mean something drifted and must be understood before pushing.

- [ ] **Step 3: Apply and verify**

Run: `supabase db push --linked --yes`

Verify through PostgREST, which is the channel that stays available:

```bash
curl -s "$URL/rest/v1/bank_imports?select=sign_convention&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -w " [%{http_code}]\n"
```

Expected: `[200]`. A `42703` means the column is absent.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807000000_bank_imports_sign_convention.sql
git commit -m "Add bank_imports.sign_convention"
```

---

### Task 5: Set the convention at upload

**Files:**
- Modify: `app/c/[publicId]/import/actions.ts` (in `uploadCsv`, near the insert at line ~216 that sets `status: "reviewing"`)

**Interfaces:**
- Consumes: `detectSignConvention` from Task 1.
- Produces: every new import carries a convention, a source of `detected`, and a confidence.

- [ ] **Step 1: Add the import**

```ts
import { detectSignConvention } from "@/lib/csv/sign-convention";
```

- [ ] **Step 2: Detect before the insert and store the result**

Immediately before the `bank_imports` insert that sets `status: "reviewing"`:

```ts
  // Decide once, at upload, how this file's signs should be read, and
  // record it so the review page can state it and the user can correct
  // it. Amounts are stored exactly as parsed; only the reading is
  // recorded here.
  const detected = detectSignConvention(
    parsedRows.map((r) => ({ amountCents: r.amount_cents })),
  );
```

Then add to the inserted object:

```ts
        sign_convention: detected.convention,
        sign_convention_source: "detected",
        sign_convention_confidence: detected.confidence,
        sign_convention_set_at: new Date().toISOString(),
```

Replace `parsedRows` with whatever the surrounding code calls the parsed
row array, and `r.amount_cents` with its amount field. Read lines 150 to
220 of the file before editing.

- [ ] **Step 3: Verify by uploading a file**

Upload a small CSV with 10 positive and 1 negative row. Then:

```bash
curl -s "$URL/rest/v1/bank_imports?select=filename,sign_convention,sign_convention_confidence&order=created_at.desc&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Expected: `sign_convention: "charges_positive"`, confidence about 0.91.

- [ ] **Step 4: Commit**

```bash
git add "app/c/[publicId]/import/actions.ts"
git commit -m "Detect and record the sign convention at upload"
```

---

### Task 6: Backfill existing credit imports

**Files:**
- Create: `scripts/backfill-sign-convention.ts`

**Interfaces:**
- Consumes: `detectSignConvention` from Task 1.
- Produces: every `account_type = 'credit'` import has a convention set from its own rows.

**This task is not optional and cannot be reordered after Task 7.** Imports
already set to `credit` are read today as "every row is an expense,
ignore the sign". The moment Task 7 makes `account_type` stop deciding
signs, a `credit` import sitting on the `charges_negative` default has
its positive charges reinterpreted as income and its candidate list
empties. That is the original bug, reintroduced on the imports someone
already worked around it on. The live import is one of these.

- [ ] **Step 1: Write the script**

```ts
// One-shot backfill: give every account_type='credit' import a real
// sign convention derived from its own rows.
//
// Run BEFORE the readers switch over (Task 7). A credit import left on
// the charges_negative default would have every charge reinterpreted as
// income the moment account_type stops deciding signs.
import { createClient } from "@supabase/supabase-js";
import { detectSignConvention } from "../lib/csv/sign-convention";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: imports, error } = await admin
    .from("bank_imports")
    .select("id, filename, account_type, sign_convention")
    .eq("account_type", "credit");
  if (error) throw new Error(error.message);

  for (const imp of imports ?? []) {
    const { data: txs } = await admin
      .from("bank_transactions")
      .select("amount_cents")
      .eq("import_id", imp.id)
      .limit(5000);
    const detected = detectSignConvention(
      (txs ?? []).map((t) => ({ amountCents: t.amount_cents as number })),
    );
    // Credit-card statements conventionally list charges positive. When
    // the rows themselves are too thin to tell, prefer that over the
    // charges_negative default, which would empty the import.
    const convention =
      detected.confidence >= 0.75 ? detected.convention : "charges_positive";
    await admin
      .from("bank_imports")
      .update({
        sign_convention: convention,
        sign_convention_source: "detected",
        sign_convention_confidence: detected.confidence,
        sign_convention_set_at: new Date().toISOString(),
      })
      .eq("id", imp.id);
    console.log(
      `${imp.filename}: ${convention} (confidence ${detected.confidence.toFixed(2)})`,
    );
  }
  console.log(`done, ${imports?.length ?? 0} credit imports`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run against production by reading first**

```bash
curl -s "$URL/rest/v1/bank_imports?select=id,filename,account_type&account_type=eq.credit" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Expected: at least the `activity (7).csv` import. Note the count.

- [ ] **Step 3: Run the backfill**

Run: `npx tsx scripts/backfill-sign-convention.ts`
Expected: `activity (7).csv: charges_positive (confidence 0.97)`.

- [ ] **Step 4: Verify the live import specifically**

```bash
curl -s "$URL/rest/v1/bank_imports?select=filename,sign_convention,sign_convention_confidence&id=eq.42231a27-1429-46b3-83a8-e8d12bac6097" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Expected: `charges_positive`, confidence 0.96 or higher.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-sign-convention.ts
git commit -m "Backfill sign conventions for existing credit imports"
```

---

### Task 7: Switch the readers

**Files:**
- Modify: `app/c/[publicId]/import/[importId]/page.tsx:50,151-156`
- Modify: `app/c/[publicId]/import/actions.ts:381,496,766,815,1018`
- Modify: `lib/csv/net-refunds.ts`

**Interfaces:**
- Consumes: `interpretAmount` from Task 1, the column from Task 4, the backfill from Task 6.
- Produces: no caller derives an expense from a raw sign comparison.

- [ ] **Step 1: Replace the review page's candidate filter**

At line 50, keep `isCredit` (it still feeds `TxRow` display and the
card-payment copy) and add the convention. Replace lines 151 to 156:

```ts
  const convention = (imp.sign_convention ?? "charges_negative") as SignConvention;
  const direction = (t: { amount_cents: number }) =>
    interpretAmount(t.amount_cents, convention).direction;

  // Expense candidates are rows the convention says are charges. Refunds
  // and income are deliberately excluded: a refund booked as an expense
  // inflates a deduction, which is what happened to a $24.45 return on
  // the 2026-08-01 import.
  const debits = allActive.filter((t) => direction(t) === "expense");
  const credits = allActive.filter((t) => direction(t) !== "expense");
```

Add `sign_convention` to the `select(...)` at line 44.

- [ ] **Step 2: Replace the two apply-path guards**

In `applyTransactions` (line ~496) and `bellaAutoApply` (line ~1018),
replace the `isCredit && amount < 0` refund skips:

```ts
    // Refunds are never auto-booked, under any convention. Booking one as
    // a positive expense inflates the deduction and as a negative expense
    // invents income. This guard existed for credit imports only; the
    // convention makes it correct everywhere.
    if (interpretAmount(tx.amount_cents, convention).direction === "refund") {
      continue;
    }
```

Load `convention` alongside `account_type` in both functions (lines ~376
and ~760 select from `bank_imports`). Keep `looksLikeCardPayment`, which
is about card payments and not about signs.

- [ ] **Step 3: Make net-refunds convention-aware**

`findRefundPairs` matches opposite signs, which is already correct. Add
the convention to its input so a caller cannot pair a chequing deposit
with a charge:

```ts
export function findRefundPairs(
  txs: NettableTx[],
  convention: SignConvention = "charges_negative",
): RefundPair[] {
```

Inside, replace any implicit "negative is the refund" assumption with
`interpretAmount(tx.amount_cents, convention).direction === "refund"`.
Read the function before editing; the default keeps existing callers
working unchanged.

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: all pass, including the fixture tests from Task 3.

- [ ] **Step 5: Verify the live import in the browser**

Open the review page for `42231a27-1429-46b3-83a8-e8d12bac6097`.
Expected: 62 rows offered, not 2. The Vercel `-$0.84` and Lowe's
`-$24.45` rows are NOT in the expense candidates.

- [ ] **Step 6: Commit**

```bash
git add "app/c/[publicId]/import/[importId]/page.tsx" \
        "app/c/[publicId]/import/actions.ts" lib/csv/net-refunds.ts
git commit -m "Read expense candidates through the sign convention, not the account type"
```

---

### Task 8: The flip control

**Files:**
- Create: `components/import/SignConventionBar.tsx`
- Modify: `app/c/[publicId]/import/actions.ts` (add `setSignConvention`)
- Modify: `app/c/[publicId]/import/[importId]/page.tsx` (render the bar)

**Interfaces:**
- Consumes: `planFlip`, `SIGN_CONFIDENCE_BANNER`, and the column.
- Produces: `setSignConvention(formData: FormData): Promise<void>` taking `importId` and `convention`.

- [ ] **Step 1: Write the server action**

```ts
/**
 * Change how one import's signs are read.
 *
 * Re-reads everything uncommitted and touches nothing that is already in
 * monthly_expenses. Booked rows are returned to the page as a review
 * list, never silently restated: that table is a filed-deduction surface.
 */
export async function setSignConvention(formData: FormData) {
  const importId = String(formData.get("import_id") ?? "");
  const next = String(formData.get("convention") ?? "");
  if (next !== "charges_negative" && next !== "charges_positive") return;

  const { admin, user } = await requireUserWithAdmin();
  const { data: imp } = await admin
    .from("bank_imports")
    .select("id, company_id, sign_convention")
    .eq("id", importId)
    .maybeSingle();
  if (!imp) return;
  await assertCompanyAccess(admin, user.id, imp.company_id as string);

  const from = (imp.sign_convention ?? "charges_negative") as SignConvention;
  if (from === next) return; // no-op, do not churn tags

  const { data: txs } = await admin
    .from("bank_transactions")
    .select("id, amount_cents, applied_category_code, applied_expense_id")
    .eq("import_id", importId);

  const plan = planFlip(
    (txs ?? []).map((t) => ({
      id: t.id as string,
      amountCents: t.amount_cents as number,
      appliedCategoryCode: t.applied_category_code as string | null,
      appliedExpenseId: t.applied_expense_id as string | null,
    })),
    from,
    next,
  );

  if (plan.clearTag.length > 0) {
    await admin
      .from("bank_transactions")
      .update({ applied_category_code: null })
      .in("id", plan.clearTag);
  }

  await admin
    .from("bank_imports")
    .update({
      sign_convention: next,
      sign_convention_source: "user",
      sign_convention_set_at: new Date().toISOString(),
    })
    .eq("id", importId);

  revalidatePath("/c/[publicId]/import/[importId]", "page");
}
```

Match `requireUserWithAdmin` and `assertCompanyAccess` to whatever the
neighbouring actions in this file use. Read `applyTransactions` first and
copy its authorization pattern exactly.

- [ ] **Step 2: Write the bar component**

```tsx
import { SIGN_CONFIDENCE_BANNER, type SignConvention } from "@/lib/csv/sign-convention";

export function SignConventionBar({
  importId,
  convention,
  confidence,
  bookedUnderPrevious,
  setSignConvention,
}: {
  importId: string;
  convention: SignConvention;
  confidence: number | null;
  bookedUnderPrevious: number;
  setSignConvention: (formData: FormData) => Promise<void>;
}) {
  const positive = convention === "charges_positive";
  const unsure = (confidence ?? 0) < SIGN_CONFIDENCE_BANNER;
  const other: SignConvention = positive
    ? "charges_negative"
    : "charges_positive";

  return (
    <div className={unsure ? "card p-4 border-gold-300/60" : "text-xs text-ink-muted"}>
      <span>
        Read as: charges are the {positive ? "positive" : "negative"} amounts.
      </span>
      <form action={setSignConvention} className="inline">
        <input type="hidden" name="import_id" value={importId} />
        <input type="hidden" name="convention" value={other} />
        <button className="btn-ghost text-xs ml-2">Not right? Flip</button>
      </form>
      {bookedUnderPrevious > 0 ? (
        <p className="mt-2 text-xs">
          {bookedUnderPrevious} rows were applied under the previous reading.
          Review them below before relying on this month&apos;s totals.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Render it above the candidates**

In the review page, above the "Expense candidates" section, passing
`imp.sign_convention`, `imp.sign_convention_confidence`, and the count of
rows with `applied_expense_id` whose direction changed under the current
convention.

- [ ] **Step 4: Verify the flip end to end**

Flip the live import to `charges_negative`. Expected: candidates drop to
2, the 48 booked rows are untouched (verify `applied_expense_id` is still
set on all 48 via PostgREST), and no `monthly_expenses` row changed.
Flip back. Expected: 60 candidates again.

```bash
curl -s "$URL/rest/v1/bank_transactions?select=id&import_id=eq.42231a27-1429-46b3-83a8-e8d12bac6097&applied_expense_id=not.is.null" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Prefer: count=exact" -H "Range: 0-0" -D - -o /dev/null | grep -i content-range
```

Expected before and after both flips: `0-0/48`.

- [ ] **Step 5: Commit**

```bash
git add components/import/SignConventionBar.tsx \
        "app/c/[publicId]/import/actions.ts" \
        "app/c/[publicId]/import/[importId]/page.tsx"
git commit -m "Let the user correct how an import's signs are read"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: the model to Task 4, the
three pure functions to Tasks 1 and 2, detection to Tasks 1 and 5, the
callers table to Task 7, the flow and interface to Task 8, the migration
hole to Task 6, the testing table to Tasks 1, 2 and 3. The two "out of
scope" items (two-column Debit/Credit CSVs, amount backfill) have no
task, correctly.

**Placeholders.** None. Every code step carries real code. Three steps
say "read the surrounding code before editing" (Tasks 5, 7, 8) rather
than inventing variable names for code not quoted in this plan; those are
instructions to verify, not deferred work.

**Type consistency.** `SignConvention`, `AmountDirection`, `FlipRow`,
`detectSignConvention`, `interpretAmount`, `planFlip`,
`SIGN_CONFIDENCE_BANNER` are spelled identically in every task.
`planFlip` returns `{ reinterpret, clearTag, needsReview }` in Tasks 2, 3
and 8 alike.

**Ordering hazard.** Task 6 must precede Task 7. Called out in bold in
Task 6 because running them out of order re-strands the live import, and
a subagent given only Task 7 would not otherwise know.
