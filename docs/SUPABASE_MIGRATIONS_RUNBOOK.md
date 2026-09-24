# Supabase migrations: prod safety net (runbook)

## The incident this prevents

`supabase/migrations/20260512000001_tax_profile_benefit_fields.sql`
adds 20 columns to `tax_profiles`. It lived in the repo but was
**never applied to the prod project** (`enisnjjbxqaliydepacc`).
Nothing automated applied migrations, they were run by hand. Result:
`saveTaxProfile` 500'd in production whenever a user submitted the
W-2 / tax-profile page (it wrote columns that didn't exist), which is
exactly the "add a new company → crash on continue" report.

Root cause: **no pipeline applied repo migrations to prod.**
`.github/workflows/db-migrate.yml` fixes that, but it needs a
one-time baseline first, because ~58 migrations were already applied
out-of-band and the remote history table doesn't know their repo
filenames.

## One-time setup

1. **Create a Supabase access token**
   Supabase dashboard → Account → Access Tokens → generate one.

2. **Add two GitHub repo secrets** (Settings → Secrets and variables → Actions):
   - `SUPABASE_ACCESS_TOKEN`: the token from step 1
   - `SUPABASE_DB_PASSWORD`: the project's database password
     (Supabase → Project Settings → Database → Connection string /
     reset password if unknown)

3. **Baseline the already-applied migrations** (do this once, locally,
   with the Supabase CLI installed and `SUPABASE_ACCESS_TOKEN` exported):

   ```bash
   supabase link --project-ref enisnjjbxqaliydepacc
   supabase migration list --linked
   ```

   For every migration filename that is ALREADY applied in prod
   (everything except genuinely-pending ones), mark it applied so
   `db push` won't try to re-run it:

   ```bash
   supabase migration repair --status applied <version>
   ```

   `<version>` is the numeric prefix of the filename
   (e.g. `20260512000001`). Repair the whole already-applied set.
   `tax_profile_benefit_fields` and the other migrations applied via
   the dashboard/MCP this cycle ARE already in prod, so mark them
   applied too. After this, `supabase migration list --linked` should
   show local and remote in sync with nothing spuriously pending.

4. **One clean manual run**
   Actions → the "DB migrations" workflow → Run workflow →
   leave `dry_run` checked. Confirm the pending list is empty (or only
   genuinely-new migrations). Re-run with `dry_run` unchecked to apply.

5. **Enable auto-push**
   Set repo variable `AUTO_PUSH = 1` (Settings → Secrets and variables
   → Actions → Variables). From then on, any migration merged to
   `main` is pushed to prod automatically.

## Safety properties of the workflow

- No secrets → the job no-ops (merging it can't break CI).
- `push` events are ignored until `AUTO_PUSH=1` (so it stays inert
  until you've baselined).
- `workflow_dispatch` defaults to a **dry run** (list only).
- `supabase db push` only applies migrations absent from
  `supabase_migrations.schema_migrations`, never re-applies.
- `concurrency` prevents two runs racing the same DB.

## Day-to-day after setup

Write a migration → open PR → merge to `main`. The workflow pushes it
to prod within a minute. Verify in the run log. No more hand-applying,
no more silent drift.

## Restoring the database from a snapshot

**Restoring to a point before a purge brings every purged sandbox tenant
back.** Point-in-time restore is not selective, so a prospect's trial data
that was destroyed on request reappears with everything else, and the
deletion we attested to the Techno Optics Hub is quietly undone.

So a restore is not finished when the database is up. It is finished when
this has also been done:

1. Ask the Hub operator for every `hub_org_id` purged **after** the
   snapshot's timestamp. The Hub holds that list and supplies it on request.
2. Re-run `POST /hq/purge_tenant` for each one.
3. Poll `GET /hq/purge_tenant/{purge_id}` to completion and confirm every
   value in `remaining` is `0`, exactly as on the first purge.

This is Fleet Adapter Contract v1 section 8.5, and it is written here rather
than in the design doc because this is the file somebody actually opens
during a restore. Background: `docs/design/fleet-integration.md`.

Those endpoints do not exist yet. Until they do, a restore that crosses a
purge is a manual escalation to the Hub operator, not something to work
around locally.
