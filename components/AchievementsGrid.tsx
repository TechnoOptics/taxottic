"use client";

import { useState } from "react";
import { BADGES, type Badge } from "@/lib/badges/catalog";
import { BadgeMedal } from "./BadgeMedal";

type Props = {
  earnedCodes: string[];
};

const TIER_LABEL: Record<Badge["tier"], string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

const HOW_TO_EARN: Record<string, string> = {
  first_company: "Create your first company in Taxottic.",
  first_forecast_setup:
    "Complete your personal tax profile (filing status, state, dependents).",
  first_income: "Log your first income entry of the year.",
  first_expense: "Log your first deductible expense of the year.",
  six_months_data:
    "Have at least six different months with income or expenses logged in the current tax year.",
  goal_setter: "Create your first savings goal under Goals.",
  goal_crusher: "Reach 100% of any active savings goal.",
  bella_curious: "Ask Bella, the in-app tax guide, your first question.",
  home_office:
    "Mark home-office in your business profile and capture utilities or office expenses.",
  vehicle:
    "Mark a business vehicle in your profile and capture car/truck expenses.",
  team_grower: "Invite at least one teammate to a company you manage.",
};

export function AchievementsGrid({ earnedCodes }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const earned = new Set(earnedCodes);

  const all = Object.values(BADGES);
  const focused = selected ? BADGES[selected] : null;

  return (
    <>
      <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
        {all.map((b) => {
          const isEarned = earned.has(b.code);
          return (
            <button
              type="button"
              key={b.code}
              onClick={() => setSelected(b.code)}
              className="card p-3 flex flex-col items-center text-center gap-2 hover:border-gold-300 hover:shadow-md transition-all focus:outline-none focus:border-gold-300"
              aria-label={`${b.title} - ${isEarned ? "earned" : "locked"}`}
            >
              <BadgeMedal code={b.code} earned={isEarned} size={48} />
              <div
                className={
                  "text-[11px] font-medium leading-tight " +
                  (isEarned ? "text-forest-900" : "text-ink-muted")
                }
              >
                {b.title}
              </div>
            </button>
          );
        })}
      </div>

      {focused ? (
        <BadgeDialog
          badge={focused}
          earned={earned.has(focused.code)}
          howToEarn={HOW_TO_EARN[focused.code] ?? focused.description}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}

function BadgeDialog({
  badge,
  earned,
  howToEarn,
  onClose,
}: {
  badge: Badge;
  earned: boolean;
  howToEarn: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${badge.title} achievement`}
      className="fixed inset-0 z-50 grid place-items-center px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-forest-900/40 backdrop-blur-sm" />
      <div
        className="relative card p-6 sm:p-8 max-w-sm w-full text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 size-8 rounded-full grid place-items-center text-ink-soft hover:bg-cream hover:text-forest-900"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M3 3 L13 13 M13 3 L3 13" />
          </svg>
        </button>

        <div className="flex flex-col items-center gap-3">
          <BadgeMedal code={badge.code} earned={earned} size={80} />
          <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
            {TIER_LABEL[badge.tier]} {earned ? "earned" : "locked"}
          </div>
          <h3 className="display text-2xl text-forest-900">{badge.title}</h3>
          <p className="text-sm text-ink-soft leading-relaxed">
            {badge.description}
          </p>
          <div className="w-full mt-2 rounded-xl bg-cream/70 border border-forest-100 px-4 py-3 text-left">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
              {earned ? "How you earned it" : "How to earn it"}
            </div>
            <p className="mt-1 text-sm text-forest-900 leading-relaxed">
              {howToEarn}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
