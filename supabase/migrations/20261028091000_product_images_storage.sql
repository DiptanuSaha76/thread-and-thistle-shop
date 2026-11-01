-- =============================================================================
-- 12. Product image storage (Supabase Storage bucket `product-images`).
--
-- The admin product form uploads images from the browser with the admin's own
-- session, to `product-images/<random-uuid>.<ext>` (no overwrite). Storage rules
-- for this bucket were never part of the repository, so this migration enforces
-- them in the database:
--
-- * Only signed-in users with the admin role in public.user_roles (the existing
--   public.is_admin() check) can upload, overwrite or delete files in
--   `product-images`. This is enforced with RESTRICTIVE policies, so it also
--   overrides any broader policy that may already exist on the live project
--   (e.g. "any signed-in user can upload").
-- * Admins get the permissions the form needs (upload, read for signed links,
--   overwrite, delete) - for this bucket only.
-- * Other buckets and files are not affected: every policy here is limited to
--   bucket_id = 'product-images'.
-- * Reading: product images are shown on the public storefront. This migration does
--   NOT change an existing bucket's public/private setting (see
--   docs/BACKEND_SETUP.md, "Product images"). It creates the bucket (public) only
--   if it does not exist yet.
-- * Upload limits enforced by Storage itself (same as the admin form): 5 MB,
--   JPEG / PNG / WebP / GIF / AVIF only (no SVG, which can carry scripts).
--
-- Safe to re-run. Changes no files and no product data.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5000000,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do nothing;

update storage.buckets
set file_size_limit = 5000000,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
where id = 'product-images';

-- ---- Restrictive: nobody but an admin may write to product-images ----------------------
-- (Restrictive policies are combined with AND, so they apply on top of any other policy.)
drop policy if exists product_images_writes_admin_only_insert on storage.objects;
create policy product_images_writes_admin_only_insert on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id is distinct from 'product-images' or public.is_admin());

drop policy if exists product_images_writes_admin_only_update on storage.objects;
create policy product_images_writes_admin_only_update on storage.objects
  as restrictive for update to authenticated
  using (bucket_id is distinct from 'product-images' or public.is_admin())
  with check (bucket_id is distinct from 'product-images' or public.is_admin());

drop policy if exists product_images_writes_admin_only_delete on storage.objects;
create policy product_images_writes_admin_only_delete on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id is distinct from 'product-images' or public.is_admin());

-- Signed-out visitors (anon key) can never write to product-images.
drop policy if exists product_images_no_anon_insert on storage.objects;
create policy product_images_no_anon_insert on storage.objects
  as restrictive for insert to anon
  with check (bucket_id is distinct from 'product-images');

drop policy if exists product_images_no_anon_update on storage.objects;
create policy product_images_no_anon_update on storage.objects
  as restrictive for update to anon
  using (bucket_id is distinct from 'product-images')
  with check (bucket_id is distinct from 'product-images');

drop policy if exists product_images_no_anon_delete on storage.objects;
create policy product_images_no_anon_delete on storage.objects
  as restrictive for delete to anon
  using (bucket_id is distinct from 'product-images');

-- ---- Permissive: what admins need, for this bucket only ------------------------------------
drop policy if exists product_images_admin_insert on storage.objects;
create policy product_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists product_images_admin_select on storage.objects;
create policy product_images_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

drop policy if exists product_images_admin_update on storage.objects;
create policy product_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists product_images_admin_delete on storage.objects;
create policy product_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
