"use client";

/**
 * Manager / super-admin only — delete a previous CSV import.
 *
 * Wraps the deleteImport server action with a native confirm() so the
 * user can't blow away an import on a single misclick. The action
 * cascades through every monthly_expense and monthly_income row that
 * was created from this import, so the dialog spells that out.
 */
export function DeleteImportButton({
  importId,
  companyId,
  action,
}: {
  importId: string;
  companyId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const ok = window.confirm(
      "Delete this import? Any expenses or income created from it will also be removed. This cannot be undone.",
    );
    if (!ok) e.preventDefault();
  };
  return (
    <form action={action} onSubmit={onSubmit} className="mt-4 flex justify-end">
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="company_id" value={companyId} />
      <button
        type="submit"
        className="text-xs text-red-700 hover:text-red-900 underline-offset-2 hover:underline"
      >
        Delete this import
      </button>
    </form>
  );
}
