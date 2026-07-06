"use client";

/**
 * Delete button for a logged personal expense, with a confirm() guard so a
 * single stray tap can't silently erase a deduction (and shift the forecast).
 * Kept as a tiny client island because the tracker page is a server component;
 * the deletePersonalExpense server action is threaded in as a prop.
 */
export function PersonalExpenseDeleteButton({
  action,
  id,
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  /** Human-readable name of the expense, for the confirm prompt. */
  label: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Remove this ${label}? This can't be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="px-2 py-1 text-xs text-ink-muted hover:text-red-700"
        aria-label={`Remove ${label}`}
      >
        Remove
      </button>
    </form>
  );
}
