"use client";

import { useEffect, useState } from "react";
import { FeedbackModal } from "@/components/FeedbackModal";

/**
 * Beta tester checklist. Walks a TestFlight / Play-beta tester through the
 * flows we most want exercised, tracks their progress on-device
 * (localStorage), and opens the existing FeedbackModal so notes land in the
 * same `feedback` table the team already triages in /admin/feedback.
 *
 * Deliberately client-only + localStorage: a tester's own progress doesn't
 * need a table, and this keeps the page zero-migration. The feedback itself
 * IS persisted server-side via submitAction.
 */

type Item = { id: string; label: string; look: string };
type Group = { title: string; blurb: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "Getting in",
    blurb: "First run, from install to your first forecast.",
    items: [
      {
        id: "signin",
        label: "Sign in (magic link, code, or a passkey / Google / Apple).",
        look: "Did sign-in feel quick and clear? Any dead ends?",
      },
      {
        id: "onboarding",
        label: "Finish onboarding and the legal acknowledgement.",
        look: "Was anything confusing, or did it ask for too much up front?",
      },
      {
        id: "welcome",
        label: "Read the welcome tiles, then land on your dashboard.",
        look: "Did the intro explain why the app wants each piece of data?",
      },
    ],
  },
  {
    title: "Personal taxes",
    blurb: "The individual (W-2) side: deductions and your year-end picture.",
    items: [
      {
        id: "personal-forecast",
        label: "Open your personal forecast and check the refund / balance.",
        look: "Do the numbers look believable for your situation?",
      },
      {
        id: "track-deduction",
        label: "Add a deduction in the tracker (charity, medical, SALT, etc.).",
        look: "Did the forecast move as expected after you added it?",
      },
      {
        id: "scan-personal",
        label: "Use 'Scan a receipt' to auto-fill an expense from a photo.",
        look: "Were the amount, date, and vendor read correctly?",
      },
      {
        id: "personal-export",
        label: "Open 'Export annual summary' and try Save as PDF / Print.",
        look: "Is the sheet clear enough to hand to a preparer?",
      },
    ],
  },
  {
    title: "Business side",
    blurb: "Skip if you don't run a business or aren't on a company yet.",
    items: [
      {
        id: "add-expense",
        label: "Add a business expense, and try a receipt scan.",
        look: "If your company set a receipt threshold, did it prompt you correctly?",
      },
      {
        id: "business-forecast",
        label: "Look at the company forecast and quarterly estimates.",
        look: "Do the quarterly numbers and deductions make sense?",
      },
      {
        id: "switch",
        label: "Switch between Personal and Business with the toggle.",
        look: "Was it obvious which side you were on at all times?",
      },
    ],
  },
  {
    title: "Receipts & mileage",
    blurb: "The capture flows that feed your deductions.",
    items: [
      {
        id: "receipt-photo",
        label: "Snap a real receipt with the camera (not just a file upload).",
        look: "Did the camera open smoothly and read the receipt?",
      },
      {
        id: "mileage",
        label: "Open the mileage screen and check the tracker status.",
        look: "Was it clear whether tracking was on, and how to fix it if not?",
      },
    ],
  },
  {
    title: "Overall feel",
    blurb: "The things that make or break a first impression.",
    items: [
      {
        id: "speed",
        label: "Move around the app: does anything feel slow or janky?",
        look: "Note any screen that stalls, flickers, or jumps.",
      },
      {
        id: "clarity",
        label: "Flag anything you found confusing or worded oddly.",
        look: "Where did you have to stop and think 'what does this mean'?",
      },
      {
        id: "trust",
        label: "Would you trust these numbers enough to plan around them?",
        look: "If not, what would you need to see to trust them?",
      },
    ],
  },
];

const ALL_IDS = GROUPS.flatMap((g) => g.items.map((i) => i.id));
const STORAGE_KEY = "taxottic-beta-checklist-v1";

export function BetaChecklist({
  submitAction,
}: {
  submitAction: (formData: FormData) => Promise<void>;
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Load saved progress once on mount (localStorage isn't available in SSR).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const ids: string[] = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate of persisted progress
        setDone(new Set(ids.filter((id) => ALL_IDS.includes(id))));
      }
    } catch {
      // Corrupt/blocked storage: start fresh, no crash.
    }
    setHydrated(true);
  }, []);

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Ignore storage write failures (private mode, quota).
      }
      return next;
    });
  }

  function reset() {
    setDone(new Set());
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // no-op
    }
  }

  const total = ALL_IDS.length;
  const count = done.size;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div>
      {/* Progress */}
      <div className="card p-5 sm:p-6 mt-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-medium text-forest-900">
            {hydrated ? `${count} of ${total} done` : "Loading your progress..."}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="btn-primary text-sm h-9 px-4"
            >
              Send feedback
            </button>
            {count > 0 ? (
              <button
                type="button"
                onClick={reset}
                className="text-xs text-ink-muted hover:text-forest-900"
              >
                Reset
              </button>
            ) : null}
          </div>
        </div>
        <div
          className="mt-3 h-2 w-full rounded-full bg-forest-100 overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Beta checklist progress"
        >
          <div
            className="h-full rounded-full bg-gold-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">
          Your progress is saved on this device. Tap &ldquo;Send feedback&rdquo;
          any time, or use the feedback option in the account menu.
        </p>
      </div>

      {/* Groups */}
      <div className="mt-6 grid gap-5">
        {GROUPS.map((group) => {
          const groupDone = group.items.filter((i) => done.has(i.id)).length;
          return (
            <div key={group.title} className="card p-5 sm:p-6">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h2 className="display text-lg text-forest-900">
                  {group.title}
                </h2>
                <span className="text-[11px] tabular-nums text-ink-muted">
                  {groupDone}/{group.items.length}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-soft">{group.blurb}</p>
              <ul className="mt-3 grid gap-2.5">
                {group.items.map((item) => {
                  const checked = done.has(item.id);
                  return (
                    <li key={item.id}>
                      <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(item.id)}
                          className="mt-0.5 size-4 shrink-0 accent-gold-600"
                        />
                        <span className="min-w-0">
                          <span
                            className={
                              "text-sm " +
                              (checked
                                ? "text-ink-muted line-through"
                                : "text-forest-900")
                            }
                          >
                            {item.label}
                          </span>
                          <span className="block text-[11.5px] text-ink-muted mt-0.5">
                            {item.look}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        submitAction={submitAction}
      />
    </div>
  );
}
