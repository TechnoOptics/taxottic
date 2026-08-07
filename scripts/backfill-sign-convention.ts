// One-shot backfill: give every account_type='credit' import a real
// sign convention derived from its own rows.
//
// Run BEFORE the readers switch over (Task 7). A credit import left on
// the charges_negative default would have every charge reinterpreted as
// income the moment account_type stops deciding signs.
//
// Pass --dry-run to print what would be written, for every import, without
// writing anything. Run that first and read the output before running for
// real, there is no undo once sign_convention_source is set to "detected".
//
// Skips any import whose sign_convention_source is already "user": if a
// human already corrected that import's reading, a re-run of this script
// must never silently revert their correction back to a software guess.
import { createClient } from "@supabase/supabase-js";
import { detectSignConvention } from "../lib/csv/sign-convention";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { persistSession: false } });

const DRY_RUN = process.argv.includes("--dry-run");
const FALLBACK_THRESHOLD = 0.75;

async function main() {
  // sign_convention_source is nullable (legacy imports predating this
  // column never got one), and plain .neq("sign_convention_source",
  // "user") would exclude those NULL rows too under SQL's three-valued
  // logic, which would silently skip the exact rows this script exists
  // to backfill. .or() below keeps NULL alongside anything not "user".
  const { data: imports, error } = await admin
    .from("bank_imports")
    .select("id, filename, account_type, sign_convention")
    .eq("account_type", "credit")
    .or("sign_convention_source.is.null,sign_convention_source.neq.user");
  if (error) throw new Error(error.message);

  if (DRY_RUN) {
    console.log("dry run, nothing will be written");
  }

  for (const imp of imports ?? []) {
    const { data: txs } = await admin
      .from("bank_transactions")
      .select("amount_cents")
      .eq("import_id", imp.id)
      .limit(5000);
    const rows = txs ?? [];
    const detected = detectSignConvention(
      rows.map((t) => ({ amountCents: t.amount_cents as number })),
    );
    // Credit-card statements conventionally list charges positive. When
    // the rows themselves are too thin to tell, prefer that over the
    // charges_negative default, which would empty the import. This
    // override must always be visible in the log line below, it is not
    // something that should ever happen quietly.
    const fallbackEngaged = detected.confidence < FALLBACK_THRESHOLD;
    const convention = fallbackEngaged
      ? "charges_positive"
      : detected.convention;

    console.log(
      `${imp.filename}: ${rows.length} rows, detected ${detected.convention} ` +
        `at ${detected.confidence.toFixed(2)} (fallback: ${fallbackEngaged ? "yes" : "no"})`,
    );

    if (DRY_RUN) continue;

    await admin
      .from("bank_imports")
      .update({
        sign_convention: convention,
        sign_convention_source: "detected",
        sign_convention_confidence: detected.confidence,
        sign_convention_set_at: new Date().toISOString(),
      })
      .eq("id", imp.id);
  }
  console.log(
    `${DRY_RUN ? "dry run done" : "done"}, ${imports?.length ?? 0} credit imports`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
