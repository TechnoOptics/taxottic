import { YearSpine } from "@/components/marketing/YearSpine";
import { spineYearFor } from "@/lib/today/spine-year";

/** Spec 4.3 item 2: the real year, the real today, each tick named. */
export function TodaySpine({ taxYear, asOf, tickNotes }: { taxYear: number; asOf: Date; tickNotes: string[] }) {
  return (
    <div className="today-spine">
      {/* Clamped: the runway only knows the years whose federal due dates
          we publish, and Today renders with next year's tax year in hand
          from 1 January. See lib/today/spine-year.ts. */}
      <YearSpine taxYear={spineYearFor(taxYear)} asOf={asOf} variant="paper" id="today-spine" tickNotes={tickNotes} />
    </div>
  );
}
