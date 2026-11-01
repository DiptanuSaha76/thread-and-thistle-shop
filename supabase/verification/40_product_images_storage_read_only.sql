-- =============================================================================
-- READ-ONLY check of the `product-images` storage bucket. Changes nothing.
-- Run it BEFORE applying 20261028091000_product_images_storage.sql (to see what the
-- live project currently allows) and AFTER (every "ok" should be true).
-- =============================================================================

-- 1. Bucket settings. "public = true" means anyone with a file's link can view it
--    (normal for storefront images). Uploads are still controlled by the policies below.
select id, public, file_size_limit, allowed_mime_types, created_at
from storage.buckets
where id = 'product-images';

-- 2. Every policy on storage.objects that mentions product-images, or that applies to
--    all buckets (no bucket_id condition at all). Review any PERMISSIVE policy here that
--    is not one of ours (names starting with product_images_): after the migration the
--    RESTRICTIVE policies still block non-admin writes, but it is worth knowing about.
select policyname,
       permissive,
       roles,
       cmd,
       qual as using_expression,
       with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') || coalesce(with_check, '')) not like '%bucket_id%'
   or (schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%product-images%')
order by permissive, cmd, policyname;

-- 3. After the migration: the admin-only write rules are in place.
select 'restrictive admin-only insert/update/delete for signed-in users' as check_name,
       (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and permissive = 'RESTRICTIVE' and policyname like 'product_images_writes_admin_only_%') = 3 as ok
union all
select 'restrictive no-write rules for signed-out visitors',
       (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and permissive = 'RESTRICTIVE' and policyname like 'product_images_no_anon_%') = 3
union all
select 'admin permissions limited to this bucket',
       (select bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%product-images%')
          from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname like 'product_images_admin_%')
union all
select 'upload limits set (5 MB, images only, no SVG)',
       exists (select 1 from storage.buckets where id = 'product-images'
               and file_size_limit = 5000000
               and not exists (select 1 from unnest(allowed_mime_types) m where m like '%svg%'))
union all
select 'admin check function exists (public.is_admin)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'is_admin');

-- 4. How many product image links are still long-lived signed links (information only).
select count(*) filter (where image_url like '%/object/sign/product-images/%') as signed_main_images,
       count(*) filter (where image_url like '%/object/public/product-images/%') as public_main_images
from public.products;
