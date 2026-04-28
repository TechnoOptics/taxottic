-- Seed deduction_categories with ~30 common entries.
-- Schedule C line numbers reference 2024 form; minor renumbering between years
-- is normal and we revisit annually.

insert into public.deduction_categories
  (code, label, description, scope, schedule_c_line, irs_pub, is_meal, is_vehicle, display_order)
values
  -- Schedule C business lines
  ('advertising', 'Advertising', 'Marketing, ads, promotional materials, website hosting for business.', 'business', 'Line 8', 'Pub 535', false, false, 10),
  ('car_truck', 'Car / truck expenses', 'Business use of a vehicle. Standard mileage or actual expenses.', 'business', 'Line 9', 'Pub 463', false, true, 20),
  ('commissions', 'Commissions and fees', 'Payments to non-employees for sales or referrals.', 'business', 'Line 10', 'Pub 535', false, false, 30),
  ('contract_labor', 'Contract labor', 'Payments to 1099 contractors. Issue them a 1099-NEC at year end.', 'business', 'Line 11', 'Pub 535', false, false, 40),
  ('depreciation', 'Depreciation / Section 179', 'Long-lived business assets written off over time, or expensed via §179.', 'business', 'Line 13', 'Pub 946', false, false, 50),
  ('benefits', 'Employee benefit programs', 'Health, life, and other benefits for employees (not the owner).', 'business', 'Line 14', 'Pub 535', false, false, 60),
  ('insurance', 'Business insurance', 'Liability, property, malpractice. Not health insurance.', 'business', 'Line 15', 'Pub 535', false, false, 70),
  ('interest_business', 'Interest (business loans)', 'Interest on business credit cards or business loans.', 'business', 'Line 16b', 'Pub 535', false, false, 80),
  ('legal_pro', 'Legal and professional services', 'Lawyers, accountants, tax preparers, consultants.', 'business', 'Line 17', 'Pub 535', false, false, 90),
  ('office', 'Office expense', 'Postage, paper, pens, printer ink, small supplies.', 'business', 'Line 18', 'Pub 535', false, false, 100),
  ('rent_property', 'Rent (other business property)', 'Office, studio, warehouse, coworking space rent.', 'business', 'Line 20b', 'Pub 535', false, false, 110),
  ('rent_equipment', 'Rent / lease (equipment)', 'Equipment, machinery, vehicle leases for business use.', 'business', 'Line 20a', 'Pub 535', false, true, 120),
  ('repairs', 'Repairs and maintenance', 'Keeping business property in working order. Improvements get capitalized.', 'business', 'Line 21', 'Pub 535', false, false, 130),
  ('supplies', 'Supplies', 'Items consumed in providing services or making products.', 'business', 'Line 22', 'Pub 535', false, false, 140),
  ('taxes_licenses', 'Taxes and licenses', 'State business taxes, business licenses, sales tax paid to taxing authorities.', 'business', 'Line 23', 'Pub 535', false, false, 150),
  ('travel', 'Travel', 'Business trips: flights, hotels, ground transportation.', 'business', 'Line 24a', 'Pub 463', false, false, 160),
  ('meals', 'Meals (50% deductible)', 'Business meals with clients or while traveling for business. Subject to 50% limit.', 'business', 'Line 24b', 'Pub 463', true, false, 170),
  ('utilities', 'Utilities', 'Internet, phone, electric, gas, water at the business location.', 'business', 'Line 25', 'Pub 535', false, false, 180),
  ('wages', 'Wages (W-2 employees)', 'Wages paid to employees. Not owner draws.', 'business', 'Line 26', 'Pub 535', false, false, 190),
  ('home_office', 'Home office', 'Portion of home used regularly and exclusively for business. Form 8829.', 'business', 'Line 30', 'Pub 587', false, false, 200),
  ('education', 'Continuing education', 'Education that maintains or improves skills required in your business.', 'business', 'Line 27a', 'Pub 970', false, false, 210),
  ('software', 'Software / subscriptions', 'SaaS tools, design software, accounting platforms.', 'business', 'Line 18', 'Pub 535', false, false, 100),
  ('bank_fees', 'Bank fees', 'Business account fees, merchant processing fees.', 'business', 'Line 27a', 'Pub 535', false, false, 220),
  ('other_business', 'Other business expense', 'Anything ordinary and necessary that does not fit elsewhere.', 'business', 'Line 27a', 'Pub 535', false, false, 999),

  -- Personal / itemized deductions
  ('charity', 'Charitable contributions', 'Donations to qualified charities. Cash and non-cash.', 'personal', null, 'Pub 526', false, false, 1010),
  ('salt', 'State and local taxes (SALT)', 'State income tax, property tax, etc. Limited to $10,000 total.', 'personal', null, 'Pub 17', false, false, 1020),
  ('mortgage_interest', 'Home mortgage interest', 'Interest on a primary or second home, up to debt limits.', 'personal', null, 'Pub 936', false, false, 1030),
  ('medical', 'Medical expenses', 'Out-of-pocket medical costs above 7.5% of AGI.', 'personal', null, 'Pub 502', false, false, 1040),
  ('student_loan_int', 'Student loan interest', 'Up to $2,500 of interest on qualified student loans (above-the-line).', 'personal', null, 'Pub 970', false, false, 1050),
  ('hsa_contribution', 'HSA contribution', 'Health Savings Account contributions if you have a high-deductible plan.', 'both', null, 'Pub 969', false, false, 1060),
  ('retirement_self', 'Self-employed retirement', 'SEP IRA, Solo 401(k), SIMPLE IRA contributions for the owner.', 'business', null, 'Pub 560', false, false, 1070),
  ('self_employed_health', 'Self-employed health insurance', 'Health insurance premiums for the owner and family. Above-the-line for self-employed.', 'business', null, 'Pub 535', false, false, 1080)
on conflict (code) do update set
  label = excluded.label,
  description = excluded.description,
  scope = excluded.scope,
  schedule_c_line = excluded.schedule_c_line,
  irs_pub = excluded.irs_pub,
  is_meal = excluded.is_meal,
  is_vehicle = excluded.is_vehicle,
  display_order = excluded.display_order;
