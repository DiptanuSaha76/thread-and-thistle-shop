-- =============================================================================
-- 14. Ids for new products and sizes, and the size key the admin panel needs.
--
-- On the live project products.id and product_variants.id are text with no
-- default, and product_variants has no unique key on (product_id, colour, size).
-- The admin panel adds products without an id, and saves sizes with
-- upsert(..., { onConflict: 'product_id,colour,size' }), which needs that key.
--
-- * New products and sizes get a lowercase UUID text id, the same format as the
--   existing ids. Existing ids are not changed (a default only applies to new rows).
-- * The size key is added only if no equivalent key exists. If two sizes of a
--   product ever had the same colour and size, it fails and the whole migration is
--   rolled back (nothing is deleted or merged).
-- * No key or foreign key is added to products.id.
--
-- Safe to re-run. Changes no rows.
-- =============================================================================

alter table public.products alter column id set default gen_random_uuid()::text;
alter table public.product_variants alter column id set default gen_random_uuid()::text;

do $$
begin
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.product_variants'::regclass
      and i.indisunique and i.indpred is null and i.indexprs is null and i.indnkeyatts = 3
      and (select array_agg(a.attname::text order by a.attname)
             from pg_attribute a
            where a.attrelid = i.indrelid and a.attnum = any (i.indkey::smallint[]))
          = array['colour', 'product_id', 'size']
  ) then
    alter table public.product_variants
      add constraint product_variants_product_colour_size_key unique (product_id, colour, size);
  end if;
end $$;
