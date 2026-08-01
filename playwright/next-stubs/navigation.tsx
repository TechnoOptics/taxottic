// Minimal next/navigation stand-in for the component-test harness.
//
// The CT harness mounts client components with Vite, outside the Next
// App Router, so `usePathname()` would throw ("expected app router to be
// mounted"). Components under test only ever READ the pathname for
// active-state highlighting, so a value driven off `location.pathname`
// is behaviourally identical for layout tests.
declare global {
  interface Window {
    __CT_PATHNAME__?: string;
  }
}

export function usePathname(): string {
  if (typeof window === "undefined") return "/";
  // Tests set window.__CT_PATHNAME__ to put a nav component into the route
  // context they want to measure (e.g. a company route, which unlocks the
  // per-company nav group).
  return window.__CT_PATHNAME__ ?? window.location.pathname;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search,
  );
}

export function useRouter() {
  return {
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  };
}

export function useParams(): Record<string, string> {
  return {};
}
