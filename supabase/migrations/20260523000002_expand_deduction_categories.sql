-- Round-out missing Schedule C buckets. User feedback (May 23 2026):
-- "Please add state and gov registration fees or fees. Please comb
-- through the categories and add the ones that are missing, there
-- should be a lot more."
--
-- Each row's schedule_c_line matches the 2024 Schedule C numbering
-- which is what the existing seed file targeted. display_order
-- slots them next to closest peers so the dropdown reads in a
-- sensible order.

insert into public.deduction_categories
  (code, label, description, scope, schedule_c_line, irs_pub,
   is_meal, is_vehicle, display_order, is_typically_recurring)
values
  (
    'state_gov_fees',
    'State / gov registration & permit fees',
    'Annual LLC or corporation renewals, Secretary of State fees, city/county business permits, professional licensing fees. Schedule C Line 23 alongside other licenses.',
    'business', 'Line 23', 'Pub 535', false, false, 151, true
  ),
  (
    'cogs',
    'Cost of goods sold (materials, parts, inventory)',
    'Materials, parts, and inventory consumed to make or resell your product. Tracked separately on Schedule C Part III; flows into Line 4.',
    'business', 'Line 4', 'Pub 334', false, false, 75, true
  ),
  (
    'postage_shipping',
    'Postage & shipping',
    'Stamps, USPS, UPS, FedEx, shipping labels, packaging materials sent to customers.',
    'business', 'Line 22', 'Pub 535', false, false, 141, true
  ),
  (
    'phone_internet',
    'Phone & internet (business portion)',
    'Cell phone bills, internet, VOIP — business-use percentage only. Schedule C Line 25 (Utilities).',
    'business', 'Line 25', 'Pub 535', false, false, 181, true
  ),
  (
    'parking_tolls',
    'Parking & tolls',
    'Parking fees, garage fees, and tolls paid during business driving. Deductible on top of the standard mileage rate.',
    'business', 'Line 9', 'Pub 463', false, true, 22, true
  ),
  (
    'merchant_fees',
    'Merchant processing fees',
    'Stripe, Square, PayPal, Shopify Payments — per-transaction processing fees. Common Schedule C Line 10 (Commissions and fees) or Line 27a.',
    'business', 'Line 10', 'Pub 535', false, false, 35, true
  ),
  (
    'dues_subscriptions',
    'Dues & subscriptions',
    'Professional association dues (bar, AICPA, local chamber), trade journals, industry magazines.',
    'business', 'Line 27a', 'Pub 535', false, false, 215, true
  ),
  (
    'equipment_purchase',
    'Equipment & tools (expensed in year)',
    'Small tools, equipment under the de minimis safe-harbor ($2,500/item per IRS Reg 1.263(a)-1(f)). Expense fully in the year purchased.',
    'business', 'Line 22', 'Pub 535', false, false, 142, false
  ),
  (
    'business_gifts',
    'Business gifts',
    'Gifts to clients or referral sources. Capped at $25 per recipient per year (IRC §274(b)).',
    'business', 'Line 27a', 'Pub 463', false, false, 225, false
  ),
  (
    'bad_debts',
    'Bad debts',
    'Receivables you previously recorded as income and now can''t collect. Cash-basis filers usually don''t qualify because the income was never recognized.',
    'business', 'Line 27a', 'Pub 535', false, false, 230, false
  ),
  (
    'pension_contributions',
    'Pension / profit-sharing (for employees)',
    'Contributions to qualified retirement plans on behalf of your employees. NOT the owner''s SEP/Solo-401k — that''s "Self-employed retirement".',
    'business', 'Line 19', 'Pub 560', false, false, 191, true
  ),
  (
    'bookkeeping',
    'Bookkeeping & accounting fees',
    'Bookkeeping software (QuickBooks, Xero), monthly bookkeeper, year-end CPA tax prep. Schedule C Line 17.',
    'business', 'Line 17', 'Pub 535', false, false, 91, true
  )
on conflict (code) do nothing;
