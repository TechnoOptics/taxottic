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

// Thick metallic gradient borders matching each tier. Used to wrap each
// medal card so earned medals literally wear the metal of their tier.
const TIER_BORDER: Record<Badge["tier"], string> = {
  bronze:
    "linear-gradient(135deg, #d99356 0%, #f0b97a 22%, #9b6f3a 55%, #7e4f1e 100%)",
  silver:
    "linear-gradient(135deg, #e2e6ea 0%, #ffffff 22%, #9aa1a8 55%, #6c7178 100%)",
  gold:
    "linear-gradient(135deg, #f2d896 0%, #fff5d4 22%, #c79532 55%, #8a661f 100%)",
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

const TIER_DELAY: Record<Badge["tier"], string> = {
  bronze: "0s",
  silver: "1.2s",
  gold: "2.4s",
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
          const borderBg = isEarned
            ? TIER_BORDER[b.tier]
            : "linear-gradient(135deg, rgba(15,45,36,0.18), rgba(15,45,36,0.08))";
          return (
            <button
              type="button"
              key={b.code}
              onClick={() => setSelected(b.code)}
              aria-label={`${b.title} - ${isEarned ? "earned" : "locked"}`}
              className="reward-card group focus:outline-none"
              style={{
                background: borderBg,
                padding: 4,
                borderRadius: 16,
              }}
            >
              <div
                className={
                  "reward-tile-inner relative rounded-[12px] px-3 py-3 flex flex-col items-center text-center gap-2 overflow-hidden transition-transform group-hover:-translate-y-0.5 " +
                  (isEarned ? "is-earned" : "is-locked")
                }
                style={
                  isEarned
                    ? { animationDelay: TIER_DELAY[b.tier] }
                    : undefined
                }
              >
                <div className="relative z-[1]">
                  <BadgeMedal code={b.code} earned={isEarned} size={48} />
                </div>
                <div
                  className={
                    "relative z-[1] text-[11px] font-medium leading-tight " +
                    (isEarned ? "text-cream" : "text-cream/45")
                  }
                >
                  {b.title}
                </div>
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
      <div className="absolute inset-0 bg-forest-900/45 backdrop-blur-sm" />
      <div
        className="relative max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: TIER_BORDER[badge.tier],
          padding: 4,
          borderRadius: 22,
        }}
      >
        <div
          className={
            "reward-tile-inner rounded-[18px] p-6 sm:p-8 text-center relative overflow-hidden " +
            (earned ? "is-earned" : "is-locked")
          }
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 size-8 rounded-full grid place-items-center text-cream/70 hover:bg-forest-700/40 hover:text-cream z-10"
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

          <div className="relative z-[1] flex flex-col items-center gap-3">
            <BadgeMedal code={badge.code} earned={earned} size={96} />
            <div className="text-[10px] uppercase tracking-[0.25em] text-gold-300">
              {TIER_LABEL[badge.tier]} {earned ? "earned" : "locked"}
            </div>
            <h3 className="display text-2xl text-cream">{badge.title}</h3>
            <p className="text-sm text-cream/75 leading-relaxed">
              {badge.description}
            </p>
            <div className="w-full mt-2 rounded-xl bg-forest-900/40 border border-gold-300/20 px-4 py-3 text-left">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-300">
                {earned ? "How you earned it" : "How to earn it"}
              </div>
              <p className="mt-1 text-sm text-cream/85 leading-relaxed">
                {howToEarn}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
