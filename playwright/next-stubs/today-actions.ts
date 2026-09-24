// Stand-in for components/today/today-actions.ts in the component-test
// harness.
//
// The real module is a "use server" file that re-exports
// dismissSyncedTransaction from app/c/[publicId]/banks/actions.ts, which
// reaches loadCompanyByPublicId -> lib/auth.ts -> next/navigation's
// redirect() and next/headers, neither of which exists under Vite. Same
// rationale as the workspace-mode stub alongside it: NeedsYourCallRow
// could not be mounted at all without this.
//
// The real notBusiness reads the transaction back after dismissing it and
// resolves true only when the row moved off "pending". The stub mirrors
// that boolean contract without touching Supabase: it records the call on
// window, then resolves window.__todayActionsResolve (default true) so a
// test can flip it to false and exercise the "could not save" path.
declare global {
  interface Window {
    __CT_NOT_BUSINESS_CALLS__?: Array<{ publicId: string; txId: string }>;
    __todayActionsResolve?: boolean;
  }
}

export async function notBusiness(formData: FormData): Promise<boolean> {
  if (typeof window === "undefined") return true;
  window.__CT_NOT_BUSINESS_CALLS__ = [
    ...(window.__CT_NOT_BUSINESS_CALLS__ ?? []),
    {
      publicId: String(formData.get("publicId") ?? ""),
      txId: String(formData.get("txId") ?? ""),
    },
  ];
  return window.__todayActionsResolve ?? true;
}
