"use client";

import { useEffect } from "react";
import { markReachedToday } from "@/lib/native/reached-today";

/** Mounted on the dashboard: the second gate for the notification prompt. */
export function MarkReachedToday() {
  useEffect(() => {
    markReachedToday();
  }, []);
  return null;
}
