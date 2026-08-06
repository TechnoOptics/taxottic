-- Recovered 20260523224345 (expand_deduction_categories_2026_05_23) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Round-out missing Schedule C buckets. User feedback: "Please add
-- state and gov registration fees or fees. Please comb through the
-- categories and add the ones that are missing, there should be a
-- lot more."
--
-- Each row's schedule_c_line matches the 2024 Schedule C numbering
-- which is what the existing seed file targeted. display_order
-- slots them next to closest peers so the dropdown reads in a
-- sensible order.

insert into public.deduction_categories
  (code, label, description, scope, schedule_c_line, irs_pub,
   is_meal, is_vehicle, display_order, is_typically_recurring)
values
  -- State/government registration & permit fees (asked-for). Distinct
  -- from taxes_licenses so the user can split out annual LLC / Sec of
  -- State / city permit renewals from sales tax + property tax.
  (
    'state_gov_fees',
    'State / gov registration & permit fees',
    'Annual LLC or corporation renewals, Secretary of State fees, city/county business permits, professional licensing fees. Schedule C Line 23 alongside other licenses.',
    'business', 'Line 23', 'Pub 535', false, false, 151, true
  ),
  -- Costs of goods sold (separate Schedule C Part III flow; for now
  -- track here so it shows in the picker; the Schedule C export
  -- groups COGS on its own page).
  (
    'cogs',
    'Cost of goods sold (materials, parts, inventory)',
    'Materials, parts, and inventory consumed to make or resell your product. Tracked separately on Schedule C Part III; flows into Line 4.',
    'business', 'Line 4', 'Pub 334', false, false, 75, true
  ),
  -- Postage & shipping (commonly its own line for ecommerce sellers).
  (
    'postage_shipping',
    'Postage & shipping',
    'Stamps, USPS, UPS, FedEx, shipping labels, packaging materials sent to customers.',
    'business', 'Line 22', 'Pub 535', false, false, 141, true
  ),
  -- Phone & internet (business portion) — utilities covers the
  -- building electric/water; this is the cell + ISP line that nearly
  -- every solo business needs.
  (
    'phone_internet',
    'Phone & internet (business portion)',
    'Cell phone bills, internet, VOIP — business-use percentage only. Schedule C Line 25 (Utilities).',
    'business', 'Line 25', 'Pub 535', false, false, 181, true
  ),
  -- Parking & tolls — common ask for users on the actual-vehicle
  -- method or for clients who use standard mileage but want to
  -- track non-mileage vehicle costs separately.
  (
    'parking_tolls',
    'Parking & tolls',
    'Parking fees, garage fees, and tolls paid during business driving. Deductible on top of the standard mileage rate.',
    'business', 'Line 9', 'Pub 463', false, true, 22, true
  ),
  -- Merchant processing fees — distinct from bank_fees because
  -- Stripe/Square/PayPal fees are a function of revenue, not bank
  -- behavior, and CPAs categorize them differently.
  (
    'merchant_fees',
    'Merchant processing fees',
    'Stripe, Square, PayPal, Shopify Payments — per-transaction processing fees. Common Schedule C Line 10 (Commissions and fees) or Line 27a.',
    'business', 'Line 10', 'Pub 535', false, false, 35, true
  ),
  -- Dues & subscriptions — professional associations, journals,
  -- trade publications. Distinct from software/SaaS subscriptions.
  (
    'dues_subscriptions',
    'Dues & subscriptions',
    'Professional association dues (bar, AICPA, local chamber), trade journals, industry magazines.',
    'business', 'Line 27a', 'Pub 535', false, false, 215, true
  ),
  -- Equipment purchases — small tools / equipment expensed in year
  -- of purchase (under the safe-harbor threshold). Distinct from
  -- depreciation/§179 which is the long-life path.
  (
    'equipment_purchase',
    'Equipment & tools (expensed in year)',
    'Small tools, equipment under the de minimis safe-harbor ($2,500/item per IRS Reg 1.263(a)-1(f)). Expense fully in the year purchased.',
    'business', 'Line 22', 'Pub 535', false, false, 142, false
  ),
  -- Business gifts — limited to $25 per recipient per year by IRC
  -- §274(b). Worth its own bucket so users hit the cap.
  (
    'business_gifts',
    'Business gifts',
    'Gifts to clients or referral sources. Capped at $25 per recipient per year (IRC §274(b)).',
    'business', 'Line 27a', 'Pub 463', false, false, 225, false
  ),
  -- Bad debts (cash-basis: only if previously included in income).
  (
    'bad_debts',
    'Bad debts',
    'Receivables you previously recorded as income and now can''t collect. Cash-basis filers usually don''t qualify because the income was never recognized.',
    'business', 'Line 27a', 'Pub 535', false, false, 230, false
  ),
  -- Pension / profit-sharing for EMPLOYEES (distinct from
  -- retirement_self which is for the owner's SEP/Solo 401k).
  (
    'pension_contributions',
    'Pension / profit-sharing (for employees)',
    'Contributions to qualified retirement plans on behalf of your employees. NOT the owner''s SEP/Solo-401k — that''s "Self-employed retirement".',
    'business', 'Line 19', 'Pub 560', false, false, 191, true
  ),
  -- Bookkeeping / accounting software (one of the most common picks;
  -- currently lumped under software OR legal_pro). Split out for clarity.
  (
    'bookkeeping',
    'Bookkeeping & accounting fees',
    'Bookkeeping software (QuickBooks, Xero), monthly bookkeeper, year-end CPA tax prep. Schedule C Line 17.',
    'business', 'Line 17', 'Pub 535', false, false, 91, true
  )
on conflict (code) do nothing;
