"use client";

import { useEffect, useRef } from "react";

/**
 * Fires clearAction once after the invite-link share card has rendered, so
 * reloading /manage doesn't keep showing the same invite. Cookie mutation
 * only works inside a Server Action, so this can't happen during the
 * page's own render — a mount effect calling back into an action is the
 * simplest way to do it after the fact.
 */
export function ClearInviteLinkOnMount({
  clearAction,
}: {
  clearAction: () => Promise<void>;
}) {
  const cleared = useRef(false);

  useEffect(() => {
    if (cleared.current) return;
    cleared.current = true;
    void clearAction();
  }, [clearAction]);

  return null;
}
