-- Two prerequisite schema changes for the catalog expansion:
--
-- 1. display_group column — short text label used to bucket items in
--    the import picker dropdown and the scorecard. Without it, a
--    user scanning 80+ categories gets lost. With it, items group
--    visually under headings like "Insurance", "Travel", "Vehicle",
--    "Employees & payroll" so the cognitive load matches a real
--    Schedule C work-paper.
--
-- 2. New enum value 'credit' on deduction_scope so we can list
--    federal tax credits (Child Tax, EITC, AOC, Residential Energy
--    etc.) alongside deductions.

alter type deduction_scope add value if not exists 'credit';

alter table public.deduction_categories
  add column if not exists display_group text;

update public.deduction_categories
set display_group = case
  when code in ('advertising','sponsorship') then 'Marketing & advertising'
  when code in ('car_truck','parking_tolls') then 'Vehicle'
  when code in ('commissions','contract_labor','merchant_fees') then 'Commissions & contractors'
  when code in ('benefits','wages','pension_contributions') then 'Employees & payroll'
  when code in ('insurance') then 'Insurance'
  when code in ('interest_business') then 'Interest'
  when code in ('legal_pro','bookkeeping') then 'Professional services'
  when code in ('office','supplies','postage_shipping','equipment_purchase','dues_subscriptions') then 'Office & supplies'
  when code in ('software') then 'Software & subscriptions'
  when code in ('phone_internet','utilities') then 'Utilities, phone & internet'
  when code in ('rent_property','rent_equipment') then 'Rent & lease'
  when code in ('repairs') then 'Repairs & maintenance'
  when code in ('taxes_licenses','state_gov_fees') then 'Taxes, licenses & permits'
  when code in ('travel','meals','business_gifts') then 'Travel, meals & gifts'
  when code in ('home_office') then 'Home office'
  when code in ('depreciation') then 'Depreciation & Section 179'
  when code in ('cogs','bad_debts') then 'Cost of goods sold'
  when code in ('education') then 'Education & training'
  when code in ('bank_fees') then 'Banking fees'
  when code in ('other_business') then 'Other business'
  when code in ('retirement_self','self_employed_health') then 'Self-employed owner'
  when code in ('charity','volunteer_mileage') then 'Charitable giving'
  when code in ('salt','mortgage_interest') then 'Home & taxes (Sched A)'
  when code in ('medical') then 'Medical (Sched A)'
  when code in ('student_loan_int','hsa_contribution') then 'Adjustments to income'
  when code in ('credit_card_payment','refunded') then 'Transfers (not deductions)'
  else 'Other'
end
where display_group is null;
