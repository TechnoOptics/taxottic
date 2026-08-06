-- Recovered 20260428145833 (phase3_seed_starter_kb) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Insert curated starter docs + chunks. These are paraphrased summaries
-- with source URLs, NOT verbatim copies of IRS publications.
do $$
declare
  pub535_id uuid;
  pub463_id uuid;
  pub587_id uuid;
  pub334_id uuid;
  pub560_id uuid;
  curated_id uuid;
begin
  insert into public.tax_kb_documents (title, doc_type, source_url, publication_year)
    values ('IRS Pub 535 - Business Expenses', 'irs_pub', 'https://www.irs.gov/forms-pubs/about-publication-535', 2024)
    returning id into pub535_id;
  insert into public.tax_kb_documents (title, doc_type, source_url, publication_year)
    values ('IRS Pub 463 - Travel, Gift, and Car Expenses', 'irs_pub', 'https://www.irs.gov/forms-pubs/about-publication-463', 2024)
    returning id into pub463_id;
  insert into public.tax_kb_documents (title, doc_type, source_url, publication_year)
    values ('IRS Pub 587 - Business Use of Your Home', 'irs_pub', 'https://www.irs.gov/forms-pubs/about-publication-587', 2024)
    returning id into pub587_id;
  insert into public.tax_kb_documents (title, doc_type, source_url, publication_year)
    values ('IRS Pub 334 - Tax Guide for Small Business', 'irs_pub', 'https://www.irs.gov/forms-pubs/about-publication-334', 2024)
    returning id into pub334_id;
  insert into public.tax_kb_documents (title, doc_type, source_url, publication_year)
    values ('IRS Pub 560 - Retirement Plans for Small Business', 'irs_pub', 'https://www.irs.gov/forms-pubs/about-publication-560', 2024)
    returning id into pub560_id;
  insert into public.tax_kb_documents (title, doc_type, source_url, publication_year)
    values ('Taxottic curated rules - 2025', 'curated', null, 2025)
    returning id into curated_id;

  insert into public.tax_kb_chunks (document_id, chunk_index, content) values
    (pub535_id, 0, 'Ordinary and necessary business expenses are deductible. An expense is ordinary if it is common in your trade and necessary if it helps you carry on the trade. Personal expenses are not deductible. Mixed-use expenses (like a phone used for both business and personal) must be allocated.'),
    (pub535_id, 1, 'Section 179 lets a small business expense up to a yearly limit of qualifying tangible property (machinery, equipment, off-the-shelf software) in the year placed in service rather than depreciating over years. The 2025 limit is $1,250,000 with a phase-out beginning at $3,130,000 of qualifying purchases.'),
    (pub535_id, 2, 'You can deduct premiums for insurance covering business losses (liability, malpractice, business-property, business-interruption). Self-employed individuals can also deduct health-insurance premiums for themselves and family above-the-line on Schedule 1.'),
    (pub463_id, 0, 'The 2025 standard mileage rate for business use of a car is 70 cents per mile. To use the standard rate, the taxpayer must own or lease the car and choose the standard method in the first year the car is placed in service. After that, you may switch between standard and actual in later years for owned cars.'),
    (pub463_id, 1, 'Business meals are 50 percent deductible when ordinary and necessary, not lavish, and either with a business contact or while traveling for business. Receipts plus a notation of the business purpose, who attended, and the date are required for amounts over $75.'),
    (pub463_id, 2, 'Travel deductions cover transportation (airfare, train, taxi to airport), lodging, and meals (subject to the 50 percent meal limit) when you are away from your tax home for business longer than an ordinary day. Commuting between home and a regular workplace is not deductible.'),
    (pub587_id, 0, 'Home office deduction requires the space to be used regularly and exclusively for business and to be your principal place of business. The simplified method allows $5 per square foot up to 300 sq ft (max $1,500). The actual-expense method allocates a percentage of the home expenses based on square footage.'),
    (pub334_id, 0, 'Self-employment tax (Schedule SE) is 15.3 percent on net SE earnings: 12.4 percent for Social Security up to the wage base ($176,100 in 2025) and 2.9 percent for Medicare with no cap. Half of SE tax is deductible above-the-line as an adjustment to income.'),
    (pub334_id, 1, 'Estimated taxes (Form 1040-ES) are due quarterly: April 15, June 15, September 15, and January 15 of the following year. You generally must pay estimated tax if you expect to owe at least $1,000 after withholding and credits. Safe harbor: pay 100% (110% if AGI over $150K) of last year''s tax to avoid penalty.'),
    (pub334_id, 2, 'A sole proprietor reports business income and expenses on Schedule C and pays SE tax on net profit. A single-member LLC defaults to the same treatment. Multi-member LLCs default to partnership taxation (Form 1065 with K-1s). Either can elect S-Corp taxation by filing Form 2553.'),
    (pub560_id, 0, 'A SEP-IRA lets a self-employed person contribute up to 25 percent of net self-employment income (calculated as compensation minus the deductible portion of SE tax), with a 2025 cap of $70,000. A Solo 401(k) allows employee deferrals (up to $23,500 in 2025, plus $7,500 catch-up if age 50+) on top of the employer 25 percent contribution, often producing a larger total contribution at lower income levels.'),
    (curated_id, 0, 'Qualified Business Income (QBI) deduction under §199A: pass-through owners (sole proprietors, partnerships, S-Corp shareholders) can deduct up to 20 percent of QBI. Below the 2025 threshold ($197,300 single / $394,600 MFJ) the math is straightforward. Above the threshold, specified service trades and the W-2 wage / qualified property tests kick in and the calculation gets complex.'),
    (curated_id, 1, 'C-Corporations pay a flat 21 percent federal income tax. Dividends are taxed again at the shareholder level (the classic double-taxation). C-Corp owners working for the company are W-2 employees and pay payroll tax on their wages. Reasonable salary requirements still apply.'),
    (curated_id, 2, 'S-Corporation owner-employees must take a reasonable salary subject to payroll taxes (FICA) before taking distributions. Distributions are not subject to SE/payroll tax. The reasonable-salary requirement is enforced by the IRS to prevent owners from zero-ing out wages and taking everything as dividends.'),
    (curated_id, 3, 'Qualified retirement contributions reduce taxable income today. Traditional IRA / 401(k) / SEP-IRA / Solo 401(k) deferrals come off AGI. Roth contributions are after-tax (no current deduction) but grow tax-free. Self-employed people get the largest deduction headroom via Solo 401(k) or SEP.'),
    (curated_id, 4, 'Standard mileage vs actual expenses (vehicles): standard is simpler and works well for most. Actual lets you deduct gas, repairs, insurance, registration, depreciation - useful when actual exceeds the standard rate (high-cost vehicles or heavy usage). Lock in your method in year one for owned vehicles; leased vehicles must use whichever method was chosen first.');
end $$;
