/**
 * Badge catalog. Source of truth for what each badge means and looks like.
 * Evaluation logic lives in lib/badges/evaluate.ts.
 */

export type Badge = {
  code: string;
  title: string;
  description: string;
  icon: string;       // single emoji used in UI; SVG mark can replace later
  tier: "bronze" | "silver" | "gold";
};

export const BADGES: Record<string, Badge> = {
  first_company: {
    code: "first_company",
    title: "Founder",
    description: "Created your first company.",
    icon: "🏛",
    tier: "bronze",
  },
  first_forecast_setup: {
    code: "first_forecast_setup",
    title: "Forecaster",
    description: "Completed your personal tax profile.",
    icon: "📈",
    tier: "bronze",
  },
  first_income: {
    code: "first_income",
    title: "First dollar",
    description: "Logged your first income entry.",
    icon: "💵",
    tier: "bronze",
  },
  first_expense: {
    code: "first_expense",
    title: "Receipt keeper",
    description: "Logged your first deductible expense.",
    icon: "🧾",
    tier: "bronze",
  },
  six_months_data: {
    code: "six_months_data",
    title: "Steady",
    description: "Six or more months of data on file. The forecast tightens.",
    icon: "🪴",
    tier: "silver",
  },
  goal_setter: {
    code: "goal_setter",
    title: "Goal setter",
    description: "Set your first savings goal.",
    icon: "🎯",
    tier: "bronze",
  },
  goal_crusher: {
    code: "goal_crusher",
    title: "Goal crusher",
    description: "Hit a savings goal you set.",
    icon: "🏆",
    tier: "gold",
  },
  bella_curious: {
    code: "bella_curious",
    title: "Curious",
    description: "Had your first conversation with Bella.",
    icon: "🪶",
    tier: "bronze",
  },
  home_office: {
    code: "home_office",
    title: "Home base",
    description: "Set up a home-office deduction.",
    icon: "🏠",
    tier: "silver",
  },
  vehicle: {
    code: "vehicle",
    title: "On the road",
    description: "Tracking a business vehicle.",
    icon: "🚗",
    tier: "silver",
  },
  first_drive: {
    code: "first_drive",
    title: "First drive logged",
    description:
      "Logged a business drive, it counts toward your mileage deduction.",
    icon: "🧭",
    tier: "silver",
  },
  team_grower: {
    code: "team_grower",
    title: "Team grower",
    description: "Invited a team member to your company.",
    icon: "🤝",
    tier: "silver",
  },
  philanthropist: {
    code: "philanthropist",
    title: "Philanthropist",
    description:
      "Gave to a 501(c)(3) cause that matters. Generosity is its own reward, and it's deductible.",
    icon: "🤍",
    tier: "gold",
  },
};

export const TIER_STYLES: Record<Badge["tier"], string> = {
  bronze: "bg-amber-100 text-amber-900 border-amber-300",
  silver: "bg-neutral-100 text-neutral-800 border-neutral-300",
  gold: "bg-gold-100 text-gold-700 border-gold-300",
};
