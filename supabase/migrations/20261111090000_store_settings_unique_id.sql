-- Keep one deterministic settings row per id before enforcing the key required
-- by the admin panel's upsert. The most recently updated row is retained.
begin;

lock table public.store_settings in access exclusive mode;

with ranked as (
  select ctid,
         row_number() over (
           partition by id
           order by updated_at desc nulls last, ctid desc
         ) as row_number
  from public.store_settings
)
delete from public.store_settings settings
using ranked
where settings.ctid = ranked.ctid
  and ranked.row_number > 1;

create unique index if not exists store_settings_id_key
  on public.store_settings (id);

commit;
