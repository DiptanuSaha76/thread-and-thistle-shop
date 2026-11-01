-- =============================================================================
-- 6. Catalogue and administration access.
--
-- * Adds explicit admin policies (based on public.user_roles via is_admin()) for
--   the tables the admin panel edits. Existing policies are NOT dropped.
-- * Hides the store's cost prices (products.cost_price) from the public API.
--   The admin panel reads them through the server after an admin check.
-- * Promo codes can no longer be listed through the API; codes are checked with
--   public.check_promo_code() instead.
-- * Browser sessions can never write to user_roles (roles are granted only by
--   the project owner in the SQL editor). Existing role rows are not touched.
-- =============================================================================

-- ---- Products ----------------------------------------------------------------------
alter table public.products enable row level security;

drop policy if exists products_select_active on public.products;
create policy products_select_active on public.products
  for select to anon, authenticated using (active);
drop policy if exists products_select_admin on public.products;
create policy products_select_admin on public.products
  for select to authenticated using (public.is_admin());
drop policy if exists products_insert_admin on public.products;
create policy products_insert_admin on public.products
  for insert to authenticated with check (public.is_admin());
drop policy if exists products_update_admin on public.products;
create policy products_update_admin on public.products
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke select on public.products from anon, authenticated;
grant select (id, active, badge, category, compare_at_price, created_at, description, details,
              image_key, image_url, images, name, price, primary_colour, rating, review_count,
              slug, sort_order, updated_at)
  on public.products to anon, authenticated;
revoke insert, update, delete, truncate on public.products from anon;
revoke delete, truncate on public.products from authenticated;

-- ---- Product variants (stock) -------------------------------------------------------
alter table public.product_variants enable row level security;

drop policy if exists variants_select_all on public.product_variants;
create policy variants_select_all on public.product_variants
  for select to anon, authenticated using (true);
drop policy if exists variants_insert_admin on public.product_variants;
create policy variants_insert_admin on public.product_variants
  for insert to authenticated with check (public.is_admin());
drop policy if exists variants_update_admin on public.product_variants;
create policy variants_update_admin on public.product_variants
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke insert, update, delete, truncate on public.product_variants from anon;
revoke delete, truncate on public.product_variants from authenticated;

-- ---- Store settings -----------------------------------------------------------------
alter table public.store_settings enable row level security;

drop policy if exists settings_select_all on public.store_settings;
create policy settings_select_all on public.store_settings
  for select to anon, authenticated using (true);
drop policy if exists settings_insert_admin on public.store_settings;
create policy settings_insert_admin on public.store_settings
  for insert to authenticated with check (public.is_admin());
drop policy if exists settings_update_admin on public.store_settings;
create policy settings_update_admin on public.store_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke insert, update, delete, truncate on public.store_settings from anon;
revoke delete, truncate on public.store_settings from authenticated;

-- ---- Support messages (admin inbox) -----------------------------------------------
alter table public.support_messages enable row level security;

drop policy if exists support_select_admin on public.support_messages;
create policy support_select_admin on public.support_messages
  for select to authenticated using (public.is_admin());
drop policy if exists support_update_admin on public.support_messages;
create policy support_update_admin on public.support_messages
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke update, delete, truncate on public.support_messages from anon;
revoke delete, truncate on public.support_messages from authenticated;

-- ---- Promo codes ----------------------------------------------------------------------
alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;

-- ---- Roles -------------------------------------------------------------------------------
alter table public.user_roles enable row level security;
revoke insert, update, delete, truncate on public.user_roles from anon, authenticated;
