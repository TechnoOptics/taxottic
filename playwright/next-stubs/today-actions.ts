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
// The brief's own spec is that "the CT harness cannot execute server
// actions" and the test asserts markup, not the dismissal, so the stub
// only needs to exist and resolve. It records calls on window in case a
// future test wants to assert the row submitted.
declare global {
  interface Window {
    __CT_NOT_BUSINESS_CALLS__?: Array<{ publicId: string; txId: string }>;
  }
}

export async function notBusiness(formData: FormData): Promise<void> {
  if (typeof window !== "undefined") {
    window.__CT_NOT_BUSINESS_CALLS__ = [
      ...(window.__CT_NOT_BUSINESS_CALLS__ ?? []),
      {
        publicId: String(formData.get("publicId") ?? ""),
        txId: String(formData.get("txId") ?? ""),
      },
    ];
  }
}
