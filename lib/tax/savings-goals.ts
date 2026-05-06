/**
 * Savings-goals engine.
 *
 * Generates a personalized list of TAX-SAVINGS GOALS that have nothing
 * to do with new business expenses — retirement contributions, HSAs,
 * 529 plans, charitable bunching, energy credits, etc. Each goal
 * carries detailed step-by-step instructions so the user can execute
 * without leaving the app.
 *
 * Pure function. No I/O. The page renders the result.
 *
 * Sources cited per goal: IRS publications + IRC sections. We are NOT
 * a tax filing tool; the page disclaimer explains this and points
 * users to a CPA for binding decisions.
 */

import { formatCents, type ForecastResult } from "./forecast";
import type { FilingStatus } from "./constants-2025";

export type GoalCategory =
  | "retirement"
  | "health"
  | "education"
  | "investment"
  | "charitable"
  | "energy"
  | "compliance";

export type SavingsGoal = {
  id: string;
  title: string;
  category: GoalCategory;
  /** Tax saved if user fully captures this goal at their marginal rate. */
  estimatedSavingsCents: number;
  /** Target $ amount the user contributes / sets aside / converts. */
  targetContributionCents: number;
  /** Last day to act for the current tax year. */
  deadline: string;
  /** One sentence — why does THIS user qualify? */
  why: string;
  /** Plain-English step-by-step instructions, ordered. */
  instructions: string[];
  citations: string[];
  whoToContact?: string;
  caveats?: string[];
};

export type SavingsGoalsInput = {
  result: ForecastResult;
  filingStatus: FilingStatus;
  /** Owner's age — drives catch-up contributions. */
  age: number | null;
  /** Two-letter state code; drives 529 deduction logic. */
  state: string | null;
  ownerW2WagesCents: number;
  spouseW2WagesCents: number;
  netSeIncomeCents: number;
  ytdRetirementContributionsCents: number;
  ytdHsaContributionsCents: number;
  ytdItemizedCents: number;
  itemize: boolean;
  dependents: number;
  dependentsUnder17: number;
  publicId: string;
};

// 2025 federal contribution limits.
const LIMITS_2025 = {
  k401_elective: 23_500_00,
  k401_catchup_50: 7_500_00,
  k401_catchup_60_63: 11_250_00, // SECURE 2.0 super-catch-up for 60-63
  k401_total_dc_limit: 70_000_00, // employee + employer combined
  ira_traditional_roth: 7_000_00,
  ira_catchup_50: 1_000_00,
  hsa_self_only: 4_300_00,
  hsa_family: 8_550_00,
  hsa_catchup_55: 1_000_00,
  fsa_health: 3_300_00,
  fsa_dependent_care: 5_000_00,
  fsa_dependent_care_mfs: 2_500_00,
  sep_ira_rate: 0.2,
  sep_ira_max: 70_000_00,
  simple_ira_elective: 16_000_00,
  simple_ira_catchup_50: 3_500_00,
  qbi_threshold_single: 197_300_00,
  qbi_threshold_mfj: 394_600_00,
  roth_phaseout_single_start: 150_000_00,
  roth_phaseout_single_end: 165_000_00,
  roth_phaseout_mfj_start: 236_000_00,
  roth_phaseout_mfj_end: 246_000_00,
  ev_credit_new: 7_500_00,
  ev_credit_used: 4_000_00,
  energy_efficient_home: 1_200_00,
};

/**
 * State 529 plan tax treatment for 2025. Numbers reflect each state's
 * statute as of Dec 2024 — verify with the user's CPA + state plan.
 *
 *   deduction: max $/filer (single); MFJ usually doubles unless noted
 *   credit:    flat tax credit instead of a deduction
 *   any_state: true if the deduction works for ANY state's plan,
 *              false if only the home-state plan qualifies
 *   notes:     one-line caveat for the instructions panel
 */
type State529Rule = {
  kind: "deduction" | "credit" | "none";
  maxSingleCents: number;
  maxMfjCents: number;
  anyState: boolean;
  notes: string;
};

const STATE_529: Record<string, State529Rule> = {
  AL: { kind: "deduction", maxSingleCents: 5_000_00, maxMfjCents: 10_000_00, anyState: false, notes: "AL 529 only." },
  AR: { kind: "deduction", maxSingleCents: 5_000_00, maxMfjCents: 10_000_00, anyState: false, notes: "Arkansas 529 plan only." },
  CO: { kind: "deduction", maxSingleCents: 25_000_00, maxMfjCents: 50_000_00, anyState: false, notes: "Effectively unlimited up to taxable income; CO plan only." },
  CT: { kind: "deduction", maxSingleCents: 5_000_00, maxMfjCents: 10_000_00, anyState: false, notes: "5-year carryforward of unused deduction." },
  DE: { kind: "deduction", maxSingleCents: 1_000_00, maxMfjCents: 2_000_00, anyState: false, notes: "Income-limited; DE plan only." },
  DC: { kind: "deduction", maxSingleCents: 4_000_00, maxMfjCents: 8_000_00, anyState: false, notes: "DC 529 plan only." },
  GA: { kind: "deduction", maxSingleCents: 4_000_00, maxMfjCents: 8_000_00, anyState: false, notes: "GA Path2College only." },
  ID: { kind: "deduction", maxSingleCents: 6_000_00, maxMfjCents: 12_000_00, anyState: false, notes: "ID 529 only." },
  IL: { kind: "deduction", maxSingleCents: 10_000_00, maxMfjCents: 20_000_00, anyState: false, notes: "IL Bright Start only." },
  IN: { kind: "credit", maxSingleCents: 1_500_00, maxMfjCents: 1_500_00, anyState: false, notes: "20% tax credit up to $1,500 per filer (any filing)." },
  IA: { kind: "deduction", maxSingleCents: 3_785_00, maxMfjCents: 7_570_00, anyState: false, notes: "IA 529 (College Savings Iowa or IAdvisor) only." },
  KS: { kind: "deduction", maxSingleCents: 3_000_00, maxMfjCents: 6_000_00, anyState: true, notes: "Any state's 529 qualifies." },
  LA: { kind: "deduction", maxSingleCents: 2_400_00, maxMfjCents: 4_800_00, anyState: false, notes: "Carryforward indefinitely; LA START only." },
  MD: { kind: "deduction", maxSingleCents: 2_500_00, maxMfjCents: 5_000_00, anyState: false, notes: "Per beneficiary; 10-year carryforward." },
  MA: { kind: "deduction", maxSingleCents: 1_000_00, maxMfjCents: 2_000_00, anyState: false, notes: "MA U.Fund / U.Plan only." },
  MI: { kind: "deduction", maxSingleCents: 5_000_00, maxMfjCents: 10_000_00, anyState: false, notes: "MET / MESP only." },
  MN: { kind: "credit", maxSingleCents: 500_00, maxMfjCents: 500_00, anyState: true, notes: "Either 50% credit (max $500) OR $1,500/$3,000 deduction; pick one." },
  MS: { kind: "deduction", maxSingleCents: 10_000_00, maxMfjCents: 20_000_00, anyState: false, notes: "MS MACS only." },
  MO: { kind: "deduction", maxSingleCents: 8_000_00, maxMfjCents: 16_000_00, anyState: true, notes: "Any state's 529 qualifies." },
  MT: { kind: "deduction", maxSingleCents: 3_000_00, maxMfjCents: 6_000_00, anyState: false, notes: "MT plan only." },
  NE: { kind: "deduction", maxSingleCents: 10_000_00, maxMfjCents: 10_000_00, anyState: false, notes: "MFJ NOT doubled. NEST only." },
  NM: { kind: "deduction", maxSingleCents: 50_000_00, maxMfjCents: 50_000_00, anyState: false, notes: "Effectively unlimited; NM plan only." },
  NY: { kind: "deduction", maxSingleCents: 5_000_00, maxMfjCents: 10_000_00, anyState: false, notes: "NY 529 (Direct or Advisor) only." },
  ND: { kind: "deduction", maxSingleCents: 5_000_00, maxMfjCents: 10_000_00, anyState: false, notes: "ND CollegeSAVE only." },
  OH: { kind: "deduction", maxSingleCents: 4_000_00, maxMfjCents: 4_000_00, anyState: false, notes: "$4K per beneficiary per year; carryforward unlimited. OH plan only." },
  OK: { kind: "deduction", maxSingleCents: 10_000_00, maxMfjCents: 20_000_00, anyState: false, notes: "OK 529 only; 5-year carryforward." },
  OR: { kind: "credit", maxSingleCents: 170_00, maxMfjCents: 340_00, anyState: false, notes: "Income-tiered credit; maxes at $170/$340. OR plan only." },
  PA: { kind: "deduction", maxSingleCents: 19_000_00, maxMfjCents: 38_000_00, anyState: true, notes: "Tied to federal annual exclusion; any state's 529 qualifies." },
  RI: { kind: "deduction", maxSingleCents: 500_00, maxMfjCents: 1_000_00, anyState: false, notes: "RI CollegeBound only; carryforward unlimited." },
  SC: { kind: "deduction", maxSingleCents: 50_000_00, maxMfjCents: 50_000_00, anyState: false, notes: "Effectively unlimited; Future Scholar only." },
  UT: { kind: "credit", maxSingleCents: 110_00, maxMfjCents: 220_00, anyState: false, notes: "4.55% × ~$2,400 cap = ~$110 credit per filer. my529 only." },
  VT: { kind: "credit", maxSingleCents: 250_00, maxMfjCents: 500_00, anyState: false, notes: "10% credit up to $2,500 per beneficiary; VT plan only." },
  VA: { kind: "deduction", maxSingleCents: 4_000_00, maxMfjCents: 4_000_00, anyState: false, notes: "Per account, not per filer; carryforward unlimited. VA529 only." },
  WV: { kind: "deduction", maxSingleCents: 50_000_00, maxMfjCents: 50_000_00, anyState: false, notes: "Effectively unlimited; SMART529 only." },
  WI: { kind: "deduction", maxSingleCents: 4_000_00, maxMfjCents: 8_000_00, anyState: true, notes: "Any state's 529 qualifies." },
};

const NO_STATE_INCOME_TAX = new Set(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]);

const Y = new Date().getUTCFullYear();
const APR15_NEXT = `${Y + 1}-04-15`;
const DEC31 = `${Y}-12-31`;
const NOV15 = `${Y}-11-15`;

export function buildSavingsGoals(input: SavingsGoalsInput): SavingsGoal[] {
  const goals: SavingsGoal[] = [];
  const marginal = Math.max(0.1, input.result.marginalRate);
  const isMfj =
    input.filingStatus === "married_filing_jointly" ||
    input.filingStatus === "qualifying_widow";
  const age = input.age ?? 0;
  const isCatchupAge = age >= 50;

  const householdAgi = input.result.taxableIncomeCents; // best proxy in our shape
  const householdW2 =
    input.ownerW2WagesCents + input.spouseW2WagesCents;

  // 1. Max W-2 401(k) elective deferral
  if (input.ownerW2WagesCents > 0) {
    const cap =
      LIMITS_2025.k401_elective +
      (isCatchupAge ? LIMITS_2025.k401_catchup_50 : 0);
    const target = cap;
    goals.push({
      id: "max_401k",
      title: `Max your 401(k) — ${formatCents(cap)} contribution cap`,
      category: "retirement",
      estimatedSavingsCents: Math.round(target * marginal),
      targetContributionCents: target,
      deadline: DEC31,
      why: `You have W-2 wages of ${formatCents(input.ownerW2WagesCents)} this year. Every pre-tax dollar you defer reduces taxable income at your ${(marginal * 100).toFixed(0)}% marginal rate.`,
      instructions: [
        "Log into your employer's payroll/benefits portal (ADP, Workday, Gusto, Rippling, Justworks, etc.) — usually labeled \"Benefits\" or \"Retirement\".",
        `Find the 401(k) elective-deferral percentage. With ${formatCents(input.ownerW2WagesCents)} of wages and ${cap} cap, you'd need to elect roughly ${Math.min(100, Math.ceil((cap / input.ownerW2WagesCents) * 100))}% — but most plans cap individual elections at 75-90% of pay, so set it to the maximum allowed for the rest of the year.`,
        "If you've contributed nothing year-to-date, calculate the catch-up election: (annual cap − YTD contributions) ÷ remaining paychecks.",
        "Check your employer match — never leave free money on the table. If they match 4% you should at minimum elect 4%.",
        "Pick a low-cost target-date fund inside the plan (look for an expense ratio under 0.20%) unless you have a specific allocation plan.",
        "Save the change. New deferral takes effect on the next payroll cycle.",
      ],
      citations: ["IRC §402(g)", "IRS Pub 560"],
      whoToContact: "Your HR / payroll administrator",
      caveats: [
        isCatchupAge
          ? `You're 50+ so you get an extra ${formatCents(LIMITS_2025.k401_catchup_50)} catch-up contribution.`
          : "If you turn 50 this year you can use the catch-up contribution.",
        age >= 60 && age <= 63
          ? `SECURE 2.0 super-catch-up: ages 60-63 can defer an extra ${formatCents(LIMITS_2025.k401_catchup_60_63)} instead of the standard $7,500.`
          : "",
        "Roth 401(k) skips the deduction now but is tax-free in retirement — choose pre-tax for current-year savings.",
      ].filter(Boolean),
    });
  }

  // 2. Solo 401(k) for self-employed
  if (input.netSeIncomeCents > 30_000_00) {
    const employeeDeferral =
      LIMITS_2025.k401_elective +
      (isCatchupAge ? LIMITS_2025.k401_catchup_50 : 0);
    // Employer profit-sharing: ~20% of net SE income (after half-SE-tax adj) up to combined cap
    const seAdjusted = Math.round(input.netSeIncomeCents * 0.9235);
    const employerShare = Math.min(
      Math.round(seAdjusted * 0.2),
      LIMITS_2025.k401_total_dc_limit - employeeDeferral,
    );
    const total = employeeDeferral + employerShare;
    goals.push({
      id: "solo_401k",
      title: `Open a Solo 401(k) — shelter up to ${formatCents(total)}`,
      category: "retirement",
      estimatedSavingsCents: Math.round(total * marginal),
      targetContributionCents: total,
      deadline: DEC31,
      why: `Your projected net self-employment income is ${formatCents(input.netSeIncomeCents)}. A Solo 401(k) lets you contribute as both employee (${formatCents(employeeDeferral)}) and employer (${formatCents(employerShare)}) — far higher cap than a SEP-IRA at the same income.`,
      instructions: [
        "Open a Solo 401(k) account at Fidelity, Schwab, Vanguard, or E*TRADE — all are free with no setup fees.",
        "You'll need your business EIN. If you don't have one, get a free EIN at irs.gov in 5 minutes (search \"EIN online application\").",
        "Pick \"Pre-Tax\" for the deductible bucket (Roth is also offered but skips the current-year deduction).",
        "Make the EMPLOYEE elective deferral by Dec 31 — fund up to $23,500 (or $31,000 if 50+).",
        "Make the EMPLOYER profit-sharing contribution by your tax-filing deadline (Apr 15, or Oct 15 with extension). Up to 20% of net SE income.",
        "If you have a spouse who works in the business, they get their own employee + employer caps — household total can exceed $140K.",
      ],
      citations: ["IRC §401(c)", "IRS Pub 560 ch. 4"],
      whoToContact: "Fidelity / Schwab / Vanguard plan-setup team",
      caveats: [
        "If you have any W-2 employees other than your spouse, a Solo 401(k) doesn't work — you need a regular 401(k) plan.",
        "Plan must be ESTABLISHED by Dec 31 even if funded later. Don't wait until April.",
      ],
    });
  }

  // 3. SEP-IRA — alternative to Solo 401(k), simpler but lower cap
  if (
    input.netSeIncomeCents > 15_000_00 &&
    input.ytdRetirementContributionsCents === 0
  ) {
    const sepIra = Math.min(
      Math.round(input.netSeIncomeCents * LIMITS_2025.sep_ira_rate),
      LIMITS_2025.sep_ira_max,
    );
    goals.push({
      id: "sep_ira",
      title: `SEP-IRA — contribute up to ${formatCents(sepIra)}`,
      category: "retirement",
      estimatedSavingsCents: Math.round(sepIra * marginal),
      targetContributionCents: sepIra,
      deadline: APR15_NEXT,
      why: `On ${formatCents(input.netSeIncomeCents)} of net business income you can stash 20% in a SEP. Simpler than a Solo 401(k) — no separate plan document, no Form 5500, just a regular IRA.`,
      instructions: [
        "Open a SEP-IRA at Fidelity, Schwab, Vanguard, or your existing brokerage. No employer paperwork needed if you're a sole proprietor.",
        "Funding deadline is your tax-filing deadline next year (Apr 15, or Oct 15 with extension) — this is FLEXIBLE unlike Solo 401(k) elective deferrals.",
        "Allocate to a low-cost index fund — VTSAX (Vanguard total US) and VTIAX (international) are common SEP defaults.",
        "Deduct the contribution on Schedule 1, Line 16 of Form 1040 next year.",
      ],
      citations: ["IRC §408(k)", "IRS Pub 560"],
      whoToContact: "Fidelity / Schwab / Vanguard SEP-IRA setup team",
      caveats: [
        "If you have employees other than yourself, you must contribute the SAME percentage of compensation for them too.",
        `${formatCents(sepIra)} is the cap on YOUR contribution; you may want to leave headroom for next year if income drops.`,
        "If you're considering both SEP-IRA and Solo 401(k), the Solo 401(k) usually shelters more at the same income. Pick one — they don't combine cleanly.",
      ],
    });
  }

  // 4. Spouse + you HSA max
  const couldUseHsa = householdW2 > 0 || input.netSeIncomeCents > 0;
  if (couldUseHsa) {
    const hsaCap = isMfj ? LIMITS_2025.hsa_family : LIMITS_2025.hsa_self_only;
    const catchup = age >= 55 ? LIMITS_2025.hsa_catchup_55 : 0;
    const totalHsa = Math.max(0, hsaCap + catchup - input.ytdHsaContributionsCents);
    if (totalHsa > 0) {
      goals.push({
        id: "max_hsa",
        title: `Max your HSA — ${formatCents(totalHsa)} more deductible this year`,
        category: "health",
        estimatedSavingsCents: Math.round(totalHsa * (marginal + 0.0765)), // income tax + FICA savings if pre-tax
        targetContributionCents: totalHsa,
        deadline: APR15_NEXT,
        why: `If you have an HSA-eligible high-deductible health plan, every dollar contributed is pre-tax now AND tax-free in retirement when used for medical expenses. Triple tax advantage — better than any other vehicle.`,
        instructions: [
          "Confirm you have an HSA-eligible HDHP (deductible ≥ $1,650 self / $3,300 family for 2025). Look at your insurance card or call HR.",
          "If your employer offers HSA contributions through payroll: increase the per-paycheck contribution. Pre-tax payroll contributions ALSO skip FICA tax (an extra 7.65% savings).",
          "If contributing outside payroll: open an HSA at Fidelity (no fees, full investment options) and direct-deposit before the Apr 15 deadline.",
          "INVEST the balance — most HSAs default to a 0.05% money-market sweep. Move it into a low-cost stock index fund. The HSA's compound-tax-free advantage is wasted if you leave it in cash.",
          "Save medical receipts permanently — you can reimburse yourself decades later, with the HSA having compounded tax-free.",
        ],
        citations: ["IRC §223", "IRS Pub 969"],
        whoToContact: "Your HR or HSA custodian (Fidelity, Lively, HealthEquity)",
        caveats: [
          isCatchupAge && age >= 55
            ? `You're 55+ so add the ${formatCents(LIMITS_2025.hsa_catchup_55)} catch-up.`
            : "",
          "If you're on Medicare you cannot contribute to an HSA. Stop contributions the month Medicare starts.",
          "FSA contributions (different vehicle) typically disqualify HSA contributions — pick one.",
        ].filter(Boolean),
      });
    }
  }

  // 5. Traditional IRA backdoor (always available; phaseouts on direct Roth + traditional deduction)
  const overRothPhaseout = isMfj
    ? householdAgi >= LIMITS_2025.roth_phaseout_mfj_end
    : householdAgi >= LIMITS_2025.roth_phaseout_single_end;
  if (overRothPhaseout) {
    const target = LIMITS_2025.ira_traditional_roth + (isCatchupAge ? LIMITS_2025.ira_catchup_50 : 0);
    goals.push({
      id: "backdoor_roth",
      title: `Backdoor Roth IRA — ${formatCents(target)} into tax-free growth`,
      category: "retirement",
      estimatedSavingsCents: 0, // current-year impact is $0 (after-tax in, after-tax out); long-term value
      targetContributionCents: target,
      deadline: APR15_NEXT,
      why: `Your AGI exceeds the Roth direct-contribution phaseout. The Backdoor Roth is the IRS-blessed workaround — contribute to a Traditional IRA, immediately convert to Roth.`,
      instructions: [
        `Open a Traditional IRA at the same brokerage where you have your Roth IRA (Fidelity, Schwab, Vanguard).`,
        `Make a NONDEDUCTIBLE contribution of up to ${formatCents(target)} to the Traditional IRA. Don't invest it — leave it as cash.`,
        "After 1-2 days (let the cash settle), convert the entire Traditional IRA balance to your Roth IRA.",
        "File Form 8606 with your tax return next year. This is critical — it tracks the basis so you don't get taxed twice.",
        "Watch out for the PRO-RATA RULE: if you have OTHER pre-tax IRAs (rollover IRA, SEP, SIMPLE), the conversion will be partly taxable. Roll those into your 401(k) first if possible.",
      ],
      citations: ["IRC §408", "IRS Notice 2014-54"],
      whoToContact: "Your brokerage's IRA department",
      caveats: [
        "Pro-rata rule: aggregate balance across all your traditional / SEP / SIMPLE IRAs determines the taxable portion. SE owners with SEP-IRAs are most affected.",
        "Roth conversions are reported in the YEAR converted, not the year contributed — convert by Dec 31 to count for this tax year.",
      ],
    });
  }

  // 6. Spousal IRA
  if (
    isMfj &&
    input.spouseW2WagesCents < 5_000_00 &&
    householdW2 + input.netSeIncomeCents > 7_000_00
  ) {
    const target = LIMITS_2025.ira_traditional_roth + (isCatchupAge ? LIMITS_2025.ira_catchup_50 : 0);
    goals.push({
      id: "spousal_ira",
      title: `Spousal IRA — ${formatCents(target)} for your spouse`,
      category: "retirement",
      estimatedSavingsCents: Math.round(target * marginal),
      targetContributionCents: target,
      deadline: APR15_NEXT,
      why: `One spouse with little or no income can still contribute the full IRA limit if the working spouse has enough earnings. Doubles your household IRA capacity.`,
      instructions: [
        "Open a Traditional IRA in the non-working spouse's name (separate from yours).",
        `Contribute up to ${formatCents(target)} from joint funds — the IRS treats the working spouse's income as the source.`,
        "If household AGI is below the deduction phaseout (~$236K MFJ), it's fully tax-deductible. Above that, do a Backdoor Roth instead.",
        "File jointly to claim the deduction.",
      ],
      citations: ["IRC §219(c)", "IRS Pub 590-A"],
    });
  }

  // 7. Tax-loss harvesting
  goals.push({
    id: "tax_loss_harvest",
    title: "Tax-loss harvest before December 31",
    category: "investment",
    estimatedSavingsCents: 3_000_00 * Math.round(marginal * 100) / 100, // up to $3K offset × marginal
    targetContributionCents: 3_000_00,
    deadline: DEC31,
    why: `Realize losing positions in your taxable brokerage account before year-end. Up to $3,000 of net losses offsets ordinary income; anything beyond carries forward forever.`,
    instructions: [
      "Log into your brokerage (Fidelity, Schwab, Vanguard, Robinhood, etc.) and pull a year-to-date realized + unrealized P&L.",
      "Identify positions held in your TAXABLE account that are down. (Do NOT touch losses in IRA / 401(k) — they don't count.)",
      "Sell the losers. Replace with a similar-but-not-identical fund to maintain market exposure (e.g. sell VTI, buy ITOT — both are total-market US ETFs from different issuers).",
      "Wait 31 days before re-buying the EXACT same security to avoid the wash-sale rule, which voids the loss.",
      "Capital losses first offset capital gains, then up to $3,000 of ordinary income, then carry forward.",
    ],
    citations: ["IRC §1211", "IRS Pub 550"],
    whoToContact: "Your brokerage; consider asking for a free tax-loss-harvesting service (Wealthfront, Betterment, Schwab Intelligent automate this)",
    caveats: [
      "Wash-sale rule: buying the same or a substantially identical security within 30 days before OR after the sale invalidates the loss.",
      "Don't tail-wag-the-dog — only harvest losses if you'd hold the replacement; don't sell winners just to harvest.",
    ],
  });

  // 8. Bunch charitable contributions
  if (input.itemize || input.ytdItemizedCents > 5_000_00) {
    const stdEst = isMfj ? 30_000_00 : 15_000_00;
    const bunchTarget = Math.max(stdEst - input.ytdItemizedCents, 5_000_00) * 2;
    goals.push({
      id: "bunch_charitable",
      title: `Bunch charitable giving — donate ${formatCents(bunchTarget)} this year, $0 next year`,
      category: "charitable",
      estimatedSavingsCents: Math.round(bunchTarget * marginal * 0.4), // half the bunched donation is "extra" deduction over standard
      targetContributionCents: bunchTarget,
      deadline: DEC31,
      why: `Your itemized total is close to the standard deduction. Bunching two years of giving into one creates an itemized year that beats standard, while next year you take the standard.`,
      instructions: [
        "Open a Donor-Advised Fund (DAF) at Fidelity Charitable, Schwab Charitable, or Vanguard Charitable. No fee to open; minimum $0-$5K depending on provider.",
        `Contribute ${formatCents(bunchTarget)} to the DAF before Dec 31 — this is the deductible event.`,
        "From the DAF, you grant out to your favorite charities over the next 1-3 years on whatever schedule you want.",
        "Donate APPRECIATED STOCK instead of cash — you avoid the capital-gains tax AND get the full market-value deduction. Double-dip.",
        "Itemize this year (Schedule A); take the standard deduction next year.",
      ],
      citations: ["IRC §170", "IRS Pub 526"],
      whoToContact: "Fidelity Charitable / Schwab Charitable / Vanguard Charitable",
      caveats: [
        "Cash to public charities is deductible up to 60% of AGI; appreciated stock up to 30%. Above those caps, carries forward 5 years.",
        "Donor-advised funds aren't required — you can also bunch with direct gifts. DAFs just give you flexibility on the timing of payouts.",
      ],
    });
  }

  // 9. QBI threshold management
  const qbiThreshold = isMfj
    ? LIMITS_2025.qbi_threshold_mfj
    : LIMITS_2025.qbi_threshold_single;
  if (
    input.netSeIncomeCents > 0 &&
    householdAgi > qbiThreshold - 30_000_00 &&
    householdAgi < qbiThreshold + 50_000_00
  ) {
    const reductionNeeded = Math.max(0, householdAgi - qbiThreshold);
    goals.push({
      id: "qbi_threshold",
      title: `Stay under the QBI cliff — drop AGI by ${formatCents(reductionNeeded || 20_000_00)}`,
      category: "retirement",
      estimatedSavingsCents: Math.round(input.netSeIncomeCents * 0.2 * marginal),
      targetContributionCents: reductionNeeded || 20_000_00,
      deadline: DEC31,
      why: `Your AGI is near the §199A QBI threshold of ${formatCents(qbiThreshold)}. Below the cliff, you get a flat 20% QBI deduction. Above, the calculation depends on W-2 wages + qualified property — Specified Service Trades + Businesses (SSTBs) lose it entirely above the phase-out.`,
      instructions: [
        `Lower AGI by maxing pre-tax retirement: 401(k), Solo 401(k), HSA, and SEP all reduce AGI.`,
        "Defer December income — push invoices to January to stay under threshold.",
        "Accelerate January expenses into December (subscriptions, supplies, deposits).",
        "If you sell stock with gains, sell some losers first to neutralize.",
        "Below the threshold the QBI math is dead simple: 20% of net business income = deduction.",
      ],
      citations: ["IRC §199A", "Treas. Reg. §1.199A"],
      caveats: [
        "If your business is an SSTB (consulting, accounting, law, health, financial services, etc.), the QBI deduction phases out completely above the cliff.",
        "Non-SSTB above-threshold businesses can still get partial QBI, limited by W-2 wages paid + qualified property — talk to a CPA.",
      ],
    });
  }

  // 10. Defined benefit plan (high-income SE)
  if (input.netSeIncomeCents > 300_000_00) {
    goals.push({
      id: "defined_benefit",
      title: "Defined Benefit Plan — shelter $50K-$300K/yr",
      category: "retirement",
      estimatedSavingsCents: Math.round(150_000_00 * marginal), // illustrative
      targetContributionCents: 150_000_00,
      deadline: DEC31,
      why: `Your projected SE income is over $300K. A defined-benefit (cash balance / pension) plan can shelter $50K-$300K+ per year — far more than any other vehicle.`,
      instructions: [
        "Hire a third-party administrator (TPA) — these are specialized: Schwab Personal Defined Benefit, EGPS, Pinnacle, Independent Actuaries.",
        "Plan must be ESTABLISHED by Dec 31 (some flexibility under SECURE Act).",
        "TPA runs an actuarial calculation based on your age and target retirement income; produces your annual contribution amount.",
        "Older entrepreneurs (50s+) get the largest contributions — the math is age-weighted.",
        "Combine with a Solo 401(k) for an additional $23,500 elective deferral.",
        "Annual cost: $1,500-$3,500 in TPA fees. Worth it only if you're confident you can fund $50K+ for 3+ years (DBs require minimum contributions).",
      ],
      citations: ["IRC §415(b)", "IRC §404(o)", "IRS Pub 560"],
      whoToContact: "A defined-benefit TPA (Schwab Personal Defined Benefit, EGPS, etc.) — talk to them before Dec 1",
      caveats: [
        "DB plans require COMMITTED ANNUAL FUNDING. If your income drops, you may have to keep contributing — much less flexible than a 401(k).",
        "Best for: stable high-income SE owners 45+ with a 5+ year horizon.",
      ],
    });
  }

  // 11. State 529 plan contribution
  const stateRule = input.state ? STATE_529[input.state.toUpperCase()] : null;
  if (
    input.dependents > 0 &&
    input.state &&
    stateRule &&
    !NO_STATE_INCOME_TAX.has(input.state.toUpperCase())
  ) {
    const cap = isMfj ? stateRule.maxMfjCents : stateRule.maxSingleCents;
    const stateRate = 0.05; // rough; the forecast uses curated flat rates already
    const savings =
      stateRule.kind === "credit"
        ? cap
        : Math.round(cap * stateRate);
    goals.push({
      id: "state_529",
      title: `${input.state} 529 plan — ${stateRule.kind === "credit" ? `up to ${formatCents(cap)} state tax credit` : `${formatCents(cap)} state tax deduction`}`,
      category: "education",
      estimatedSavingsCents: savings,
      targetContributionCents: cap,
      deadline: DEC31,
      why: `${input.state} offers a state ${stateRule.kind} for 529 contributions. ${stateRule.notes}`,
      instructions: [
        stateRule.anyState
          ? "Open a 529 account at any state's plan — the deduction works for ANY state's 529. Compare expense ratios; Utah's my529, NY's 529, and CA's ScholarShare are usually top picks for low fees."
          : `Open a 529 account specifically at ${input.state}'s state-sponsored plan — only that plan's contributions qualify for ${input.state}'s tax benefit.`,
        "Name your child / dependent as the beneficiary. Account owner can stay in your name (you control the money).",
        `Contribute up to ${formatCents(cap)} before Dec 31 to lock in this year's ${stateRule.kind}.`,
        "Pick an age-based portfolio (auto-de-risks as the kid approaches college) unless you have a specific allocation plan.",
        "Claim the contribution on your state tax return next year — your state's tax software walks you through it.",
      ],
      citations: ["IRC §529", `${input.state} Department of Revenue`],
      whoToContact: `${input.state} 529 plan customer service`,
      caveats: [
        stateRule.notes,
        "529 funds withdrawn for non-qualified use are subject to a 10% federal penalty + ordinary income tax on earnings.",
        "Excess contributions (above the state cap) earn no extra deduction but are still allowable per IRS rules — just check your state's annual cap.",
      ],
    });
  }

  // 12. Health FSA (W-2 only, alternative to HSA)
  if (input.ownerW2WagesCents > 0 && input.ytdHsaContributionsCents === 0) {
    goals.push({
      id: "health_fsa",
      title: `Health FSA — ${formatCents(LIMITS_2025.fsa_health)} pre-tax for medical expenses`,
      category: "health",
      estimatedSavingsCents: Math.round(LIMITS_2025.fsa_health * (marginal + 0.0765)),
      targetContributionCents: LIMITS_2025.fsa_health,
      deadline: NOV15, // open enrollment usually closes in Nov
      why: `If your employer offers a Health FSA and you don't have an HSA-qualified high-deductible health plan, this is the next-best pre-tax medical bucket. Saves income tax + FICA.`,
      instructions: [
        "Wait for your employer's open-enrollment window (usually Nov-Dec for the following calendar year).",
        `Elect ${formatCents(LIMITS_2025.fsa_health)} for 2026 — the limit is set IN THE BENEFITS PORTAL, not via Plaid or anywhere else.`,
        "Use it during the plan year for prescription co-pays, glasses, dental, OTC drugs (since 2020), period products, sunscreen.",
        "Most plans have a $640 carryover or a 2.5-month grace period — the rest of unused balance is forfeited.",
      ],
      citations: ["IRC §125", "IRS Notice 2024-71"],
      whoToContact: "Your HR / benefits administrator",
      caveats: [
        "Use it or lose it — only ~$640 carries over to next year.",
        "Cannot have both an HSA and a Health FSA in the same year (limited-purpose FSAs are an exception, just for dental/vision).",
      ],
    });
  }

  // 13. Dependent Care FSA
  if (input.dependentsUnder17 > 0 && input.ownerW2WagesCents > 0) {
    const cap =
      input.filingStatus === "married_filing_separately"
        ? LIMITS_2025.fsa_dependent_care_mfs
        : LIMITS_2025.fsa_dependent_care;
    goals.push({
      id: "dependent_care_fsa",
      title: `Dependent Care FSA — ${formatCents(cap)} pre-tax for childcare`,
      category: "health",
      estimatedSavingsCents: Math.round(cap * (marginal + 0.0765)),
      targetContributionCents: cap,
      deadline: NOV15,
      why: `You have ${input.dependentsUnder17} dependent${input.dependentsUnder17 === 1 ? "" : "s"} under 17 and W-2 wages. The Dependent Care FSA shelters daycare / after-school / summer-camp costs from income tax + FICA.`,
      instructions: [
        "During open enrollment, elect up to $5,000 (or $2,500 if MFS) into your employer's Dependent Care FSA.",
        "Submit reimbursement claims with receipts from your daycare provider during the year.",
        "Keep your provider's tax ID — needed for the Form 2441 you'll file next April.",
        "Cannot also claim the same expenses for the Child & Dependent Care Tax Credit. Pick whichever's bigger.",
      ],
      citations: ["IRC §129", "IRS Pub 503"],
      caveats: [
        "Strictly 'use it or lose it' — funds don't carry over (unlike Health FSAs).",
        "Only qualifies if BOTH spouses work (or are full-time students). Stay-at-home parent generally disqualifies.",
      ],
    });
  }

  // 14. Energy Efficient Home Improvement Credit
  goals.push({
    id: "energy_credit",
    title: `Energy Efficient Home Improvement Credit — up to ${formatCents(LIMITS_2025.energy_efficient_home)}/yr`,
    category: "energy",
    estimatedSavingsCents: LIMITS_2025.energy_efficient_home,
    targetContributionCents: 5_000_00, // typical install cost
    deadline: DEC31,
    why: `IRC §25C credit for qualifying home upgrades — heat pumps, insulation, windows, doors, electrical panel upgrades, energy audit. 30% of cost up to specific caps.`,
    instructions: [
      "Audit candidates for upgrade: heat pump ($2,000 max credit), heat-pump water heater ($2,000), insulation/air-sealing ($1,200), exterior windows ($600), doors ($500), electrical panel ($600), home energy audit ($150).",
      "Hire a licensed contractor for the install (DIY equipment qualifies but DIY labor doesn't).",
      "Save the manufacturer's certification statement — IRS asks for it on audit.",
      "File Form 5695 with next year's return.",
      "Credit is non-refundable but renews every year — you can take the $1,200 max again next year for different upgrades.",
    ],
    citations: ["IRC §25C", "IRS Form 5695 instructions"],
    caveats: [
      "Equipment must be installed at your PRIMARY RESIDENCE in the U.S. Vacation homes don't qualify for most items.",
      "Solar panels and geothermal use the bigger Residential Clean Energy Credit (§25D) instead — 30% with no annual cap.",
    ],
  });

  // 15. EV tax credit
  goals.push({
    id: "ev_credit",
    title: `EV tax credit — ${formatCents(LIMITS_2025.ev_credit_new)} new / ${formatCents(LIMITS_2025.ev_credit_used)} used`,
    category: "energy",
    estimatedSavingsCents: LIMITS_2025.ev_credit_new,
    targetContributionCents: 30_000_00, // typical EV cost
    deadline: DEC31,
    why: `If you're considering an EV anyway, do the purchase before year-end. Direct $7,500 (new) or $4,000 (used) tax credit, transferable to the dealer at point of sale.`,
    instructions: [
      "Check the IRS-qualified vehicle list at fueleconomy.gov/feg/tax2023.shtml — must be on the list AND meet the battery-mineral / assembly rules.",
      `Income caps: ${formatCents(150_000_00)} single / ${formatCents(300_000_00)} MFJ for new EVs; ${formatCents(75_000_00)} / ${formatCents(150_000_00)} for used. Above these you get nothing.`,
      "MSRP caps: $80K SUVs/trucks, $55K cars (new only).",
      "AT THE DEALERSHIP: the IRS allows the credit to be TRANSFERRED — the dealer applies it as a discount, you don't have to wait until tax time.",
      "If transferring, you sign IRS Form 15400 at delivery.",
      "Claim on Form 8936 next April if you didn't transfer at the dealer.",
    ],
    citations: ["IRC §30D (new)", "IRC §25E (used)"],
    caveats: [
      "Income cap is on AGI in the year of purchase OR the year prior — pick the lower.",
      "Credit is non-refundable if not transferred — if you owe less than $7,500 in tax, you don't get the rest as a refund.",
    ],
  });

  // 16. Increase W-4 withholding (compliance)
  if (input.result.underpaymentRisk) {
    const shortfall = Math.max(
      0,
      Math.round(input.result.totalTaxCents * 0.9) -
        input.result.alreadyPaidCents,
    );
    goals.push({
      id: "fix_underpayment",
      title: `Avoid the underpayment penalty — bump withholding by ${formatCents(shortfall)}`,
      category: "compliance",
      estimatedSavingsCents: Math.round(shortfall * 0.08), // ~8% IRS penalty rate
      targetContributionCents: shortfall,
      deadline: DEC31,
      why: `Your withholding + estimated payments are below the 90%-of-current-year safe harbor. Without action, the IRS will assess an underpayment penalty (~8% APR on the shortfall).`,
      instructions: [
        "If you have W-2 wages: ask your HR to update Form W-4 — Step 4(c) lets you ADD extra withholding per paycheck. Set this to (shortfall) ÷ remaining paychecks.",
        "If self-employed: send a quarterly estimated payment via IRS Direct Pay (irs.gov/payments). Do this before Jan 15 of next year for the Q4 deadline.",
        "Confirm in your payroll portal that the change took effect on the next paycheck.",
        "Bonus: withholding (W-4 box 4c) is treated as if paid evenly across the year — even a December bump dodges underpayment penalties on Q1-Q3 shortfalls. Estimated payments don't get this benefit.",
      ],
      citations: ["IRC §6654", "IRS Form W-4 instructions"],
      whoToContact: "Your HR / payroll team",
    });
  }

  // 17. SIMPLE IRA (alternative for SE owners with employees)
  if (input.netSeIncomeCents > 0 && input.netSeIncomeCents < 100_000_00) {
    const target =
      LIMITS_2025.simple_ira_elective +
      (isCatchupAge ? LIMITS_2025.simple_ira_catchup_50 : 0);
    goals.push({
      id: "simple_ira",
      title: `SIMPLE IRA — ${formatCents(target)} elective deferral`,
      category: "retirement",
      estimatedSavingsCents: Math.round(target * marginal),
      targetContributionCents: target,
      deadline: DEC31,
      why: `For sole-proprietors with modest income (under $100K), a SIMPLE IRA has lower setup overhead than a 401(k) and slightly higher caps than a regular IRA. Good middle-ground.`,
      instructions: [
        "Establish the SIMPLE IRA plan by Oct 1 (for current year). Most brokerages have 1-page forms.",
        "Contribute as the EMPLOYEE: up to $16,000 ($19,500 with 50+ catch-up) by Dec 31.",
        "EMPLOYER match: required at 3% of compensation OR 2% non-elective. For sole-prop, you ARE the employer.",
        "Lower limit than a 401(k) but minimal paperwork — no Form 5500, no nondiscrimination testing.",
      ],
      citations: ["IRC §408(p)", "IRS Pub 560"],
      caveats: [
        "Must be the only retirement plan you offer — no Solo 401(k) AND SIMPLE IRA in the same year.",
        "Withdrawals within the first 2 years are subject to a 25% penalty (vs. the standard 10%).",
      ],
    });
  }

  // 18. Mega Backdoor Roth (if employer plan permits)
  if (input.ownerW2WagesCents > 100_000_00) {
    goals.push({
      id: "mega_backdoor_roth",
      title: "Mega Backdoor Roth — up to $46,500 extra Roth contribution",
      category: "retirement",
      estimatedSavingsCents: 0, // current-year impact $0; long-term huge
      targetContributionCents: 46_500_00,
      deadline: DEC31,
      why: `If your 401(k) plan supports after-tax contributions AND in-service withdrawals (or in-plan Roth conversions), you can stuff up to $46,500 into Roth on top of the $23,500 elective.`,
      instructions: [
        "Check your 401(k) Summary Plan Description for: (1) AFTER-TAX contributions allowed, and (2) IN-SERVICE WITHDRAWALS / IN-PLAN ROTH CONVERSIONS.",
        "If both: max your regular pre-tax 401(k) ($23,500), then make AFTER-TAX (not Roth) contributions up to the combined cap ($70,000 minus pre-tax, minus employer match).",
        "Either roll the after-tax balance to a Roth IRA via in-service withdrawal, OR do an in-plan Roth conversion (Mega Backdoor Roth proper).",
        "After-tax money that grows in the 401(k) is taxable on conversion; minimize growth before the conversion (do it monthly).",
      ],
      citations: ["IRC §402(c)", "IRS Notice 2014-54"],
      whoToContact: "Your 401(k) plan administrator (Fidelity NetBenefits, Schwab Workplace, etc.)",
      caveats: [
        "If your plan doesn't support after-tax + in-service, this is a no-go. Most large-company 401(k)s do (Google, Microsoft, Amazon, Meta); many small-company plans don't.",
        "After-tax contributions are NOT the same as Roth contributions in the plan. Look for a separate after-tax bucket.",
      ],
    });
  }

  // 19. Claim Saver's Credit (low-income household)
  if (
    householdAgi < 75_000_00 &&
    (input.ytdRetirementContributionsCents > 0 || input.ownerW2WagesCents > 0)
  ) {
    goals.push({
      id: "savers_credit",
      title: "Saver's Credit — up to $2,000 tax credit for retirement contributions",
      category: "retirement",
      estimatedSavingsCents: 2_000_00,
      targetContributionCents: 4_000_00,
      deadline: DEC31,
      why: `Your AGI qualifies you for the Saver's Credit — a non-refundable credit of 10-50% of retirement contributions, up to $2,000 ($4,000 MFJ).`,
      instructions: [
        "Make ANY retirement contribution: 401(k), Traditional IRA, Roth IRA, SEP, SIMPLE.",
        "AGI brackets (2025): 50% credit at $24K MFJ / $12K single, 20% at $26K/$13K, 10% at $39K/$19.5K. Above $76,500 MFJ / $38,250 single — no credit.",
        "File Form 8880 with your tax return.",
        "Stacks WITH the regular deduction — you get the deduction AND the credit.",
      ],
      citations: ["IRC §25B"],
      caveats: [
        "Non-refundable: doesn't generate a refund beyond what you owe.",
        "Cannot claim if you're a full-time student.",
      ],
    });
  }

  return goals.sort(
    (a, b) => b.estimatedSavingsCents - a.estimatedSavingsCents,
  );
}

export function totalSavingsAcrossGoals(goals: SavingsGoal[]): number {
  return goals.reduce((a, g) => a + g.estimatedSavingsCents, 0);
}
