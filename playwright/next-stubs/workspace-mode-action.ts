// Stand-in for app/actions/workspace-mode.ts in the component-test harness.
//
// The real module is a "use server" file: importing it pulls in the Supabase
// server client and next/headers, neither of which exists under Vite, so
// LeftRail could not be mounted at all without this. Same rationale as the
// next/navigation and next/link stubs alongside it.
//
// Calls are recorded on window so a test can assert WHEN the rail decides to
// persist the workspace mode, in particular that it fires on a
// mode-declaring route and stays silent on /dashboard.
declare global {
  interface Window {
    __CT_MODE_WRITES__?: string[];
  }
}

export async function setWorkspaceMode(mode: string): Promise<void> {
  if (typeof window !== "undefined") {
    window.__CT_MODE_WRITES__ = [...(window.__CT_MODE_WRITES__ ?? []), mode];
  }
}

export async function clearWorkspaceMode(): Promise<void> {
  if (typeof window !== "undefined") {
    window.__CT_MODE_WRITES__ = [...(window.__CT_MODE_WRITES__ ?? []), "clear"];
  }
}
