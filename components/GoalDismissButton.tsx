"use client";

import { deleteGoal } from "@/app/goals/actions";

type Props = {
  goalId: string;
  goalTitle: string;
};

export function GoalDismissButton({ goalId, goalTitle }: Props) {
  return (
    <form
      action={deleteGoal}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Delete the goal "${goalTitle}"? This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={goalId} />
      <button
        type="submit"
        aria-label={`Delete goal ${goalTitle}`}
        title="Delete this goal"
        className="text-ink-muted hover:text-red-700 transition-colors size-5 inline-flex items-center justify-center text-base leading-none rounded hover:bg-red-50"
      >
        ×
      </button>
    </form>
  );
}
