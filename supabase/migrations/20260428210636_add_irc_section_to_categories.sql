-- Recovered 20260428210636 (add_irc_section_to_categories) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.deduction_categories
  add column if not exists irc_section text,
  add column if not exists pub_chapter text,
  add column if not exists irs_url text;

-- Update each category with its actual IRC citation, the Pub chapter where
-- the rule lives, and a deep link to the IRS page. Sources: 26 U.S.C. and
-- the linked Publications. Confirmed against current IRS guidance.

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 11 - Other Expenses',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'advertising';

update public.deduction_categories set
  irc_section = '§162; §274(d)',
  pub_chapter = 'Pub 463 ch. 4 - Transportation',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-463'
where code = 'car_truck';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 11',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'commissions';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 2 - Employees Pay',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'contract_labor';

update public.deduction_categories set
  irc_section = '§§167-168, §179',
  pub_chapter = 'Pub 946 ch. 1-3',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-946'
where code = 'depreciation';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 15-B - Employer Tax Guide to Fringe Benefits',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-15-b'
where code = 'benefits';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 6 - Insurance',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'insurance';

update public.deduction_categories set
  irc_section = '§163',
  pub_chapter = 'Pub 535 ch. 4 - Interest',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'interest_business';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 11',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'legal_pro';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 11',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'office';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 3 - Rent Expense',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'rent_property';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 3',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'rent_equipment';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 7 - Costs You Can Deduct or Capitalize',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'repairs';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 11',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'supplies';

update public.deduction_categories set
  irc_section = '§164',
  pub_chapter = 'Pub 535 ch. 5 - Taxes',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'taxes_licenses';

update public.deduction_categories set
  irc_section = '§162; §274(d)',
  pub_chapter = 'Pub 463 ch. 1 - Travel',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-463'
where code = 'travel';

update public.deduction_categories set
  irc_section = '§274(n)',
  pub_chapter = 'Pub 463 ch. 2 - Meals',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-463'
where code = 'meals';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 11',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'utilities';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 15 (Circular E) - Employer Tax Guide',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-15'
where code = 'wages';

update public.deduction_categories set
  irc_section = '§280A',
  pub_chapter = 'Pub 587 - Business Use of Your Home',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-587'
where code = 'home_office';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 970 ch. 12 - Business Deduction for Work-Related Education',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-970'
where code = 'education';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 11',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'software';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 11',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'bank_fees';

update public.deduction_categories set
  irc_section = '§162',
  pub_chapter = 'Pub 535 ch. 11',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'other_business';

-- Personal / itemized
update public.deduction_categories set
  irc_section = '§170',
  pub_chapter = 'Pub 526 - Charitable Contributions',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-526'
where code = 'charity';

update public.deduction_categories set
  irc_section = '§164(b)(6)',
  pub_chapter = 'Schedule A instructions; Pub 17 ch. 11',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-17'
where code = 'salt';

update public.deduction_categories set
  irc_section = '§163(h)',
  pub_chapter = 'Pub 936 - Home Mortgage Interest Deduction',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-936'
where code = 'mortgage_interest';

update public.deduction_categories set
  irc_section = '§213',
  pub_chapter = 'Pub 502 - Medical and Dental Expenses',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-502'
where code = 'medical';

update public.deduction_categories set
  irc_section = '§221',
  pub_chapter = 'Pub 970 ch. 4 - Student Loan Interest',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-970'
where code = 'student_loan_int';

update public.deduction_categories set
  irc_section = '§223',
  pub_chapter = 'Pub 969 - Health Savings Accounts',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-969'
where code = 'hsa_contribution';

update public.deduction_categories set
  irc_section = '§§401(c), 408(k), 408(p)',
  pub_chapter = 'Pub 560 - Retirement Plans for Small Business',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-560'
where code = 'retirement_self';

update public.deduction_categories set
  irc_section = '§162(l)',
  pub_chapter = 'Pub 535 ch. 6; Schedule 1 instructions',
  irs_url = 'https://www.irs.gov/forms-pubs/about-publication-535'
where code = 'self_employed_health';
