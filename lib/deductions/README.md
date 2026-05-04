# lib/deductions

Master IRS deduction reference data + applicability rules.

## Files

- **types.ts** - `MasterDeduction` shape, `CompanyEntityType` union.
- **master.ts** - `MASTER_DEDUCTIONS` array. **Generated**, do not hand-edit.
- **applicability.ts** - `appliesToCompany`, `groupByCategory`,
  `searchDeductions`. Maps the free-text "Business type applicability" string
  in the source workbook to a yes/no for a given company entity + industry.
- **eligibility.ts** - separate eligibility scoring used by the forecast
  page (predates this module; not regenerated).

## Regenerating master.ts

The data is an export of the IRS-aligned master deduction checklist:

```
master_business_deduction_checklist_by_entity.xlsx → Master Checklist sheet
1025 deductions × 28 categories
```

To regenerate when the source workbook is updated:

```bash
# install one-shot xlsx parser into a temp dir
TMP=$(mktemp -d)
( cd "$TMP" && npm install --no-save xlsx >/dev/null )

# run the inline script - adjust source path as needed
SRC="C:/Users/abelm/Downloads/master_business_deduction_checklist_by_entity.xlsx"
DST="lib/deductions/master.ts"

node - <<'EOF' "$SRC" "$DST"
const XLSX = require('xlsx');
const fs = require('fs');
const [, , src, dst] = process.argv;
const wb = XLSX.readFile(src);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Master Checklist'], { defval: '' });
const out = [
  '// THIS FILE IS GENERATED from master_business_deduction_checklist_by_entity.xlsx',
  '// (Master Checklist sheet). 1025 deductions across 28 categories, sourced from',
  '// IRS publications. To regenerate, see lib/deductions/README.md.',
  '',
  'import type { MasterDeduction } from "./types";',
  '',
  'export const MASTER_DEDUCTIONS: readonly MasterDeduction[] = [',
];
for (const r of rows) {
  out.push('  ' + JSON.stringify({
    code: r['Code'], category: r['Category'], name: r['Deduction / expense type'],
    applicability: r['Business type applicability'], industry: r['Best-fit business / industry'],
    notes: r['Deductibility notes'], source: r['IRS / source URL'],
  }) + ',');
}
out.push('] as const;', '');
fs.writeFileSync(dst, out.join('\n'));
console.log('wrote', rows.length, 'deductions to', dst);
EOF
```

Then `npx tsc --noEmit` to confirm no type drift.

## Where the data shows up

- **Deductions explorer** - `app/c/[publicId]/deductions/page.tsx` uses
  `MASTER_DEDUCTIONS` + `appliesToCompany` to render the per-company
  collapsible browse view. Filtered by `company.entity_type`.
- (Future) **Bank-transaction triage** - when an `account_transactions` row
  is suggested a deduction, we can join the suggestion's `category_code`
  back to the master list to surface the IRS source URL + notes inline.
