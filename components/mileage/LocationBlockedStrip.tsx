import { WarningIcon } from "@/components/ui/Icons";
import { OpenLocationSettingsButton } from "./OpenLocationSettingsButton";

/** Dashboard strip for the viewer's own phone when its permission blocks capture. */
export function LocationBlockedStrip({ short, fix }: { short: string; fix: string }) {
  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50/60 p-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <WarningIcon className="size-4 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{short}.</p>
          <p className="mt-1 text-xs">{fix}.</p>
          <div className="mt-3">
            <OpenLocationSettingsButton />
          </div>
        </div>
      </div>
    </div>
  );
}
