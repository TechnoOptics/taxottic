import { redirect } from "next/navigation";

/**
 * Guard for manager/department-lead-only business surfaces (company
 * income, deductions, sales tax, export, CPA engagement, etc.).
 *
 * The app's privacy model (see the company forecast page): plain members
 * and expensers only get their own expenses, mileage, and chat — they
 * must never see core business financials. Their nav already hides these
 * links; this closes the direct-URL hole server-side. RLS also scopes the
 * underlying rows to the caller, so this is defense-in-depth, not the only
 * line. Redirects non-privileged members to their own expenses view.
 */
export function requireBusinessManager(
  role: string | null | undefined,
  publicId: string,
): void {
  if (role !== "manager" && role !== "lead") {
    redirect(`/c/${publicId}/expenses`);
  }
}
