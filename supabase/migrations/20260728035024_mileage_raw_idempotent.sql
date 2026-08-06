-- Recovered 20260728035024 (mileage_raw_idempotent) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

with ranked as (
  select id,
    row_number() over (
      partition by driver_user_id, company_id, captured_at
      order by (consumed_at is null) asc,
               coalesce(accuracy_m, 1e9) asc,
               id asc
    ) as rn
  from public.mileage_points_raw
)
delete from public.mileage_points_raw p
using ranked r
where p.id = r.id and r.rn > 1;

create unique index if not exists mileage_points_raw_identity_uq
  on public.mileage_points_raw (driver_user_id, company_id, captured_at);
