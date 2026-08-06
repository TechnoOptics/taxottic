# Migration history: state, and what is still wrong

Last reconciled: 2026-08-06. Project `enisnjjbxqaliydepacc` (taxottic).

## Why this file exists

For most of this project's life, migrations were applied through the Supabase
MCP and the dashboard SQL editor rather than through `supabase db push`. Both
paths write to `supabase_migrations.schema_migrations`, but they stamp their own
version number, unrelated to the filename in `supabase/migrations/`. The result
was two disjoint records of the same work:

- 96 local files the history table had never heard of, and
- 122 history rows with no local file.

`supabase migration list` was therefore not just noisy, it was actively
misleading: it reported 96 migrations as pending against a production database
that had already had every one of them applied.

## What was fixed

**The replay hazard.** Those 96 versions are now marked `applied` in the history
table. Before, anyone running `supabase db push` (or worse, reaching for
`--include-all` to get past the error) would have replayed 96 migrations against
a live database holding real tax and financial records. That is no longer
possible, because there is nothing left for push to consider pending.

They were not marked applied on faith. Each one was checked against the live
schema, introspected via `supabase gen types typescript --linked`:

| Result | Count |
| --- | --- |
| Every table, column and function it declares exists | 59 |
| Declares no checkable DDL (policies, grants, data only) | 22 |
| Objects appeared to be missing | 15 |

All 15 apparent misses were verified false positives:

- 13 were trigger functions (`*_touch_updated_at`, `handle_new_*`,
  `handle_company_member_removed_clear_chat`). `gen types` only emits
  RPC-callable functions, so a trigger function is absent from that file whether
  or not it exists. Corroborated by the fact that *no* `touch_*` or `handle_new_*`
  function appears in the generated types at all.
- 2 were columns (`subscriptions.auto_topup_pack`, `bank_imports.account_type`).
  Both were queried directly through PostgREST and both returned HTTP 200,
  meaning they exist. The control query `subscriptions.id` correctly returned
  400, confirming the probe distinguishes present from absent.

**A duplicate version number.** `20260725000000` was used by two different
files, `mileage_trip_source` and `tracker_alerts_kind`. Only one version can be
recorded in the history table, so on any rebuilt database exactly one of them
would silently never run. `tracker_alerts_kind` was renamed to
`20260725000001`.

## What is still wrong, and it matters

**This folder cannot rebuild the database.** 15 tables that exist in production
have no `create table` statement anywhere in `supabase/migrations/`:

```
admin_actions          bank_transactions   goals        subscriptions
badges                 bella_conversations passkeys     tax_kb_chunks
bank_import_duplicates bella_messages      reminders    tax_kb_documents
bank_imports           feedback            taxottic_enterprise_inquiries
```

Five functions are likewise unaccounted for: `bella_kb_search`, `current_plan`,
`passkey_lookup_by_email`, `show_limit`, `show_trgm`.

These were created by the 122 out-of-band migrations. Their DDL was never
written to a file, and it survives in exactly one place: the `statements`
column of `supabase_migrations.schema_migrations`.

Consequences, in order of how much they should worry you:

1. **There is no disaster recovery path from source.** Restoring from this repo
   alone produces a database missing billing, banking, auth and Bella.
2. **No staging or preview environment can be stood up from these migrations.**
3. `supabase db push` still refuses to run, because remote holds 122 versions
   with no local file. This is currently a *safety feature*, not a bug, and it
   should stay broken until item 1 is resolved.

The 122 rows were deliberately **not** marked reverted, even though the CLI
suggests exactly that when it errors. Reverting them would delete the only
remaining record that those objects were ever created, and would make the folder
*look* complete while still being unable to rebuild anything. A tidy history that
lies is worse than a messy one that does not.

## How to finish this

Requires SQL access, which the Supabase MCP could not provide on 2026-08-06
(`net::ERR_FAILED` on every call, while the network itself was healthy).

1. Read the missing DDL out of the history table:

   ```sql
   select version, name, statements
   from supabase_migrations.schema_migrations
   where version in ( ...the 122 versions with no local file... )
   order by version;
   ```

2. Write each one to `supabase/migrations/<version>_<name>.sql` verbatim. Do not
   paraphrase or reconstruct from the schema: RLS policies, grants, indexes,
   constraints and triggers are not recoverable from `gen types`, and those are
   precisely the parts that carry the security model.

3. Re-run the completeness check that produced the table above: every live table
   and function should have a local `create` statement.

4. Only then is `supabase db push` safe to unblock.

## Going forward

Apply migrations with `supabase db push`, not the MCP or the SQL editor. The
convenience of the MCP is what produced 122 orphaned history rows and cost this
project its ability to rebuild itself from source.

Where a one-off statement genuinely must go in out of band, write the migration
file first, commit it, and record it under that same version number.
