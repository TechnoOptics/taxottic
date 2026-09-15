"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { openLocationSettings } from "@/lib/mileage/native-tracker";

/**
 * The one action a blocked location permission has, wherever it is read.
 *
 * On the phone it opens the OS Location sheet, the same call
 * TrackingHealthBanner makes. On the web there is no sheet to open, so a
 * control labelled "Open location settings" would promise something the
 * browser cannot do; the web renders a link that says where it actually
 * goes instead. Both are at least 44px tall: this is a touch target on
 * the surface where the permission is broken.
 *
 * A client component so the strip that mounts it can stay server
 * rendered, and so the native check happens after mount rather than
 * during a render the server also runs.
 */
export function OpenLocationSettingsButton() {
  const [native, setNative] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const cap = (
      window as unknown as {
        Capacitor?: { isNativePlatform?: () => boolean };
      }
    ).Capacitor;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot platform read after mount
    if (cap?.isNativePlatform?.() === true) setNative(true);
  }, []);

  const className = "btn-primary inline-flex min-h-11 items-center text-xs";

  if (!native) {
    return (
      <Link href="/mileage" className={className}>
        Fix this on the Mileage page
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        setOpening(true);
        try {
          await openLocationSettings();
        } finally {
          setOpening(false);
        }
      }}
    >
      {opening ? "Opening…" : "Open location settings"}
    </button>
  );
}
