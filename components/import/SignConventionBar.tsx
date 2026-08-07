import { SIGN_CONFIDENCE_BANNER, type SignConvention } from "@/lib/csv/sign-convention";

/**
 * Lets the user correct how one import's amount signs are read.
 *
 * Below SIGN_CONFIDENCE_BANNER confidence, the split between charges
 * and refunds was thin or even, so this renders as a card the user is
 * likely to notice. At or above that confidence it renders as a quiet
 * one-line note, still correctable but not demanding attention.
 */
export function SignConventionBar({
  importId,
  convention,
  confidence,
  bookedUnderPrevious,
  setSignConvention,
}: {
  importId: string;
  convention: SignConvention;
  confidence: number | null;
  bookedUnderPrevious: number;
  setSignConvention: (formData: FormData) => Promise<void>;
}) {
  const positive = convention === "charges_positive";
  const unsure = (confidence ?? 0) < SIGN_CONFIDENCE_BANNER;
  const other: SignConvention = positive
    ? "charges_negative"
    : "charges_positive";

  return (
    <div
      className={
        unsure
          ? "card p-4 border-gold-300/60"
          : "text-xs text-ink-muted"
      }
    >
      <span>
        Read as: charges are the {positive ? "positive" : "negative"} amounts.
      </span>
      <form action={setSignConvention} className="inline">
        <input type="hidden" name="import_id" value={importId} />
        <input type="hidden" name="convention" value={other} />
        <button className="btn-ghost text-xs ml-2">Not right? Flip</button>
      </form>
      {bookedUnderPrevious > 0 ? (
        <p className="mt-2 text-xs">
          {bookedUnderPrevious} rows were applied under the previous reading.
          Review them below before relying on this month&apos;s totals.
        </p>
      ) : null}
    </div>
  );
}
