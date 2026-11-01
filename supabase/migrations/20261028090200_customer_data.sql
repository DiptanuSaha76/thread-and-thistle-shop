-- =============================================================================
-- 4. Customer-owned data: saved addresses, preferences, and a persistent
--    cart/wishlist for signed-in customers.
--
-- * Owner-only policies are added for the existing yearth_addresses and
--   yearth_account_preferences tables (no rows are changed).
-- * Light format checks are added as NOT VALID constraints, so they apply to new
--   and edited rows only and cannot fail on existing data.
-- * New table public.customer_carts (one row per customer). It stores product,
--   colour, size and quantity only; prices are always re-read at checkout.
-- =============================================================================

-- ---- Saved addresses -----------------------------------------------------------
alter table public.yearth_addresses enable row level security;

drop policy if exists addresses_select_own on public.yearth_addresses;
create policy addresses_select_own on public.yearth_addresses
  for select to authenticated using (user_id = auth.uid());
drop policy if exists addresses_insert_own on public.yearth_addresses;
create policy addresses_insert_own on public.yearth_addresses
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists addresses_update_own on public.yearth_addresses;
create policy addresses_update_own on public.yearth_addresses
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists addresses_delete_own on public.yearth_addresses;
create policy addresses_delete_own on public.yearth_addresses
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.yearth_addresses from anon;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'yearth_addresses_format'
                   and conrelid = 'public.yearth_addresses'::regclass) then
    alter table public.yearth_addresses add constraint yearth_addresses_format check (
      char_length(full_name) between 1 and 120
      and phone ~ '^[6-9][0-9]{9}$'
      and char_length(line1) between 1 and 200
      and char_length(coalesce(line2, '')) <= 200
      and char_length(city) between 1 and 80
      and char_length(state) between 1 and 80
      and pincode ~ '^[1-9][0-9]{5}$'
      and char_length(label) between 1 and 40
    ) not valid;
  end if;
end $$;

-- Make one address the default in a single statement (no half-updated state).
create or replace function public.set_default_address(p_address uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if not exists (select 1 from public.yearth_addresses where id = p_address and user_id = v_uid) then
    raise exception using errcode = 'P0002', message = 'ADDRESS_NOT_FOUND';
  end if;
  update public.yearth_addresses
  set is_default = (id = p_address)
  where user_id = v_uid and is_default is distinct from (id = p_address);
end;
$$;
revoke all on function public.set_default_address(uuid) from public, anon;
grant execute on function public.set_default_address(uuid) to authenticated;

-- ---- Account preferences --------------------------------------------------------
alter table public.yearth_account_preferences enable row level security;

drop policy if exists preferences_select_own on public.yearth_account_preferences;
create policy preferences_select_own on public.yearth_account_preferences
  for select to authenticated using (user_id = auth.uid());
drop policy if exists preferences_insert_own on public.yearth_account_preferences;
create policy preferences_insert_own on public.yearth_account_preferences
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists preferences_update_own on public.yearth_account_preferences;
create policy preferences_update_own on public.yearth_account_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.yearth_account_preferences from anon;

-- ---- Persistent cart and wishlist ---------------------------------------------
create table if not exists public.customer_carts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 50),
  wishlist jsonb not null default '[]'::jsonb
    check (jsonb_typeof(wishlist) = 'array' and jsonb_array_length(wishlist) <= 200),
  promo_code text check (promo_code is null or char_length(promo_code) <= 40),
  updated_at timestamptz not null default now()
);

alter table public.customer_carts enable row level security;

drop policy if exists carts_select_own on public.customer_carts;
create policy carts_select_own on public.customer_carts
  for select to authenticated using (user_id = auth.uid());
drop policy if exists carts_insert_own on public.customer_carts;
create policy carts_insert_own on public.customer_carts
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists carts_update_own on public.customer_carts;
create policy carts_update_own on public.customer_carts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists carts_delete_own on public.customer_carts;
create policy carts_delete_own on public.customer_carts
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.customer_carts from anon;
grant select, insert, update, delete on public.customer_carts to authenticated;
grant all on public.customer_carts to service_role;
