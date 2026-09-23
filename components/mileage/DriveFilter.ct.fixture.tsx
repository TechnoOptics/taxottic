"use client";

import { useState } from "react";
import { DriveFilter } from "./DriveFilter";
import type { FilterKey } from "@/lib/mileage/drive-filter";

/**
 * DriveFilter is CONTROLLED: the chosen window is owned by whatever holds
 * the drives (useDriveWindow), because one control with two owners is one
 * edit away from two answers. A component test still has to tap it, so
 * this fixture is the smallest possible owner: it holds the window and
 * nothing else, and forwards every other prop untouched.
 */
export function DriveFilterHarness({
  drives,
  onChange,
  onLoadOlder,
  loadingOlder,
  olderError,
}: {
  drives: { started_at: string }[];
  onChange?: (key: FilterKey) => void;
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
  olderError?: string | null;
}) {
  const [picked, setPicked] = useState<{ key: FilterKey; at: number }>({
    key: "all",
    at: 0,
  });
  return (
    <DriveFilter
      drives={drives}
      picked={picked}
      onChange={(k) => {
        setPicked({ key: k, at: Date.now() });
        onChange?.(k);
      }}
      onLoadOlder={onLoadOlder}
      loadingOlder={loadingOlder}
      olderError={olderError}
    />
  );
}
