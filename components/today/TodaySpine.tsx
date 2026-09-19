import { YearSpine } from "@/components/marketing/YearSpine";

/** Spec 4.3 item 2: the real year, the real today, each tick named. */
export function TodaySpine({ taxYear, asOf, tickNotes }: { taxYear: number; asOf: Date; tickNotes: string[] }) {
  return (
    <div className="today-spine">
      <YearSpine taxYear={taxYear} asOf={asOf} variant="paper" id="today-spine" tickNotes={tickNotes} />
    </div>
  );
}
