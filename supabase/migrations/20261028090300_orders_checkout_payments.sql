-- =============================================================================
-- 5. Orders, checkout and payments.
--
-- * public.create_order(): the only way customers create orders. It re-reads
--   prices, stock, shipping rules and promo codes from the database, locks the
--   stock rows it uses (no overselling), and is idempotent (a retried request
--   returns the same order instead of creating a second one).
-- * public.cancel_order(): customer cancellation with the allowed rules.
-- * Orders can no longer be inserted or deleted by browser clients, and their
--   money/ownership/payment/address fields can only be changed by trusted
--   server code. Admins can change status/tracking/notes, following valid
--   status transitions only. Cancelling an unshipped order returns its stock.
-- * Customers can no longer read the store's internal cost figures or admin
--   notes on their own orders.
-- * Online payments (Razorpay): payment records and server-only functions that
--   mark an order paid after the server has verified the payment.
--
-- Run supabase/verification/00_preflight_read_only.sql first: this migration
-- refuses to run if an existing trigger already adjusts stock on orders.
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select t.tgname, p.proname
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid in ('public.orders'::regclass, 'public.order_items'::regclass)
      and not t.tgisinternal
      and t.tgname not in ('orders_guard_before_update', 'orders_restock_after_cancel')
      and p.prosrc ilike '%product_variants%'
  loop
    raise exception 'Trigger % (function %) already changes product_variants when orders change. '
      'Review it before applying this migration so stock is not adjusted twice.', r.tgname, r.proname;
  end loop;
end $$;

-- ---- Live column formats ------------------------------------------------------------------
-- On the live project orders.created_at / updated_at and support_messages.created_at are text,
-- and orders.order_number has no default. Times are written in one format, UTC ISO 8601 as
-- produced by JavaScript's Date.toISOString() (e.g. 2026-10-28T18:03:38.175Z), so they parse in
-- every browser and sort correctly as text.
create or replace function public.iso_utc_text(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Order numbers YE1001, YE1002, ... (public.orders is empty, so they cannot clash).
create sequence if not exists public.order_number_seq start with 1001;
revoke all on sequence public.order_number_seq from public, anon, authenticated;

-- ---- New columns / tables (additive) ---------------------------------------------
alter table public.orders add column if not exists idempotency_key uuid;
create unique index if not exists orders_user_idempotency_key
  on public.orders (user_id, idempotency_key) where idempotency_key is not null;

create table if not exists public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders (id) on delete restrict, -- orders.id is text
  provider text not null check (provider in ('razorpay')),
  provider_order_id text not null unique,
  provider_payment_id text unique,
  amount integer not null check (amount > 0), -- smallest currency unit (paise)
  currency text not null default 'INR',
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'paid_after_cancel')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_payments_order_id on public.order_payments (order_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_variants_stock_non_negative'
                   and conrelid = 'public.product_variants'::regclass) then
    alter table public.product_variants
      add constraint product_variants_stock_non_negative check (stock >= 0) not valid;
  end if;
end $$;

-- ---- Promo codes ----------------------------------------------------------------
-- The storefront advertises YEARTH10; make sure it exists (added only if missing).
insert into public.promo_codes (code, percent, active)
select 'YEARTH10', 10, true
where not exists (select 1 from public.promo_codes where upper(code) = 'YEARTH10');

-- Returns the discount percent for an active code, or null. Reveals nothing else.
create or replace function public.check_promo_code(p_code text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- promo_codes.percent and .active are text on the live project.
  select pct from (
    select case when btrim(percent) ~ '^[0-9]{1,3}$' then btrim(percent)::integer end as pct
    from public.promo_codes
    where upper(code) = upper(btrim(coalesce(p_code, '')))
      and lower(btrim(active)) in ('true', 't', '1', 'yes')
  ) c
  where pct between 1 and 100
  limit 1
$$;
revoke all on function public.check_promo_code(text) from public;
grant execute on function public.check_promo_code(text) to anon, authenticated, service_role;

-- ---- Order creation ----------------------------------------------------------------
create or replace function public.create_order(
  p_items jsonb,
  p_shipping jsonb,
  p_payment text,
  p_promo text default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing record;
  v_settings record;
  v_elem jsonb;
  v_qty numeric;
  v_pids uuid[] := '{}';
  v_colours text[] := '{}';
  v_sizes text[] := '{}';
  v_qtys int[] := '{}';
  v_lines jsonb;
  v_bad text;
  v_line record;
  v_subtotal integer := 0;
  v_cost integer := 0;
  v_shipping integer;
  v_percent integer := 0;
  v_discount integer := 0;
  v_total integer;
  v_order_id text;
  v_now text := public.iso_utc_text(now());
  v_order_number text;
  v_promo text := nullif(upper(btrim(coalesce(p_promo, ''))), '');
  v_name text;
  v_phone text;
  v_address text;
  v_city text;
  v_state text;
  v_pincode text;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'INVALID_REQUEST';
  end if;

  -- A retried request returns the order it already created.
  select id, order_number, total into v_existing
  from public.orders where user_id = v_uid::text and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v_existing.id, 'order_number', v_existing.order_number,
                              'total', v_existing.total::numeric, 'existing', true);
  end if;

  if not public.profile_is_complete(v_uid) then
    raise exception using errcode = 'P0001', message = 'PROFILE_INCOMPLETE';
  end if;

  select * into v_settings from public.store_settings where id = 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'STORE_NOT_CONFIGURED';
  end if;
  if not ((p_payment = 'cod' and coalesce(v_settings.cod_enabled, false))
          or (p_payment = 'razorpay' and coalesce(v_settings.razorpay_enabled, false))) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_METHOD_UNAVAILABLE';
  end if;

  -- Shipping address (India): same rules as the checkout form.
  if p_shipping is null or jsonb_typeof(p_shipping) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_ADDRESS';
  end if;
  v_name := btrim(coalesce(p_shipping ->> 'fullName', ''));
  v_phone := regexp_replace(coalesce(p_shipping ->> 'phone', ''), '[^0-9]', '', 'g');
  if v_phone ~ '^91[6-9][0-9]{9}$' then
    v_phone := right(v_phone, 10);
  end if;
  v_address := btrim(coalesce(p_shipping ->> 'address', ''));
  v_city := btrim(coalesce(p_shipping ->> 'city', ''));
  v_state := btrim(coalesce(p_shipping ->> 'state', ''));
  v_pincode := btrim(coalesce(p_shipping ->> 'pincode', ''));
  if char_length(v_name) not between 1 and 120 or v_phone !~ '^[6-9][0-9]{9}$'
     or char_length(v_address) not between 1 and 300 or char_length(v_city) not between 1 and 80
     or char_length(v_state) not between 1 and 80 or v_pincode !~ '^[1-9][0-9]{5}$' then
    raise exception using errcode = '22023', message = 'INVALID_ADDRESS';
  end if;

  -- Items: 1-20 lines of {productId, colour, size, quantity 1-10}. Prices sent by
  -- the browser (if any) are ignored.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'INVALID_ITEMS';
  end if;
  for v_elem in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_elem) <> 'object'
       or coalesce(jsonb_typeof(v_elem -> 'quantity'), '') <> 'number'
       or coalesce(v_elem ->> 'productId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or char_length(btrim(coalesce(v_elem ->> 'colour', ''))) not between 1 and 60
       or char_length(btrim(coalesce(v_elem ->> 'size', ''))) not between 1 and 20 then
      raise exception using errcode = '22023', message = 'INVALID_ITEMS';
    end if;
    v_qty := (v_elem ->> 'quantity')::numeric;
    if v_qty <> trunc(v_qty) or v_qty < 1 or v_qty > 10 then
      raise exception using errcode = '22023', message = 'INVALID_ITEMS';
    end if;
    v_pids := v_pids || (v_elem ->> 'productId')::uuid;
    v_colours := v_colours || btrim(v_elem ->> 'colour');
    v_sizes := v_sizes || btrim(v_elem ->> 'size');
    v_qtys := v_qtys || v_qty::int;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('pid', pid, 'colour', colour, 'size', size, 'qty', qty)), '[]'::jsonb)
  into v_lines
  from (
    select pid, colour, size, sum(qty)::int as qty
    from unnest(v_pids, v_colours, v_sizes, v_qtys) as t(pid, colour, size, qty)
    group by pid, colour, size
  ) s;
  if exists (select 1 from jsonb_array_elements(v_lines) e where (e ->> 'qty')::int > 10) then
    raise exception using errcode = '22023', message = 'INVALID_ITEMS';
  end if;

  -- Every line must be an active product with that colour/size.
  select coalesce(p.name, 'An item') into v_bad
  from jsonb_array_elements(v_lines) e
  left join public.products p on p.id = (e ->> 'pid')
  left join public.product_variants v
    on v.product_id = (e ->> 'pid') and v.colour = e ->> 'colour' and v.size = e ->> 'size'
  where p.id is null or not p.active or v.id is null
  limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'PRODUCT_UNAVAILABLE', detail = v_bad;
  end if;

  -- Lock the stock rows in a fixed order (prevents overselling and deadlocks),
  -- then check stock and price everything from the database.
  for v_line in
    select v.id as variant_id, v.stock, p.name, p.price, p.cost_price,
           e ->> 'colour' as colour, e ->> 'size' as size, (e ->> 'qty')::int as qty
    from jsonb_array_elements(v_lines) e
    join public.product_variants v
      on v.product_id = (e ->> 'pid') and v.colour = e ->> 'colour' and v.size = e ->> 'size'
    join public.products p on p.id = v.product_id
    order by v.id
    for update of v
  loop
    if v_line.stock < v_line.qty then
      raise exception using errcode = 'P0001', message = 'OUT_OF_STOCK',
        detail = format('%s (%s / %s)', v_line.name, v_line.colour, v_line.size),
        hint = greatest(v_line.stock, 0)::text;
    end if;
    v_subtotal := v_subtotal + v_line.price * v_line.qty;
    v_cost := v_cost + coalesce(v_line.cost_price, 0) * v_line.qty;
  end loop;

  v_shipping := case when v_subtotal = 0 or v_subtotal > v_settings.free_shipping_threshold then 0
                     else v_settings.shipping_fee end;
  if v_promo is not null then
    v_percent := public.check_promo_code(v_promo);
    if v_percent is null then
      raise exception using errcode = 'P0001', message = 'INVALID_PROMO';
    end if;
    v_discount := round(v_subtotal * v_percent / 100.0)::integer;
  end if;
  v_total := v_subtotal + v_shipping - v_discount;

  -- orders.id has no default on the live project: the id is created here (same lowercase UUID text format).
  v_order_id := gen_random_uuid()::text;

  begin
    insert into public.orders (
      id, order_number, created_at, updated_at, user_id, status, payment_method, payment_status, promo_code,
      ship_name, ship_phone, ship_address, ship_city, ship_state, ship_pincode,
      subtotal, shipping, discount, total, cost_total, idempotency_key
    ) values (
      v_order_id, 'YE' || nextval('public.order_number_seq'), v_now, v_now, v_uid, 'Processing', p_payment, 'pending', v_promo,
      v_name, '+91' || v_phone, v_address, v_city, v_state, v_pincode,
      v_subtotal, v_shipping, v_discount, v_total, v_cost, p_idempotency_key
    )
    returning id, order_number into v_order_id, v_order_number;

    insert into public.order_items (
      id, order_id, product_id, variant_id, product_name, product_slug, colour, size,
      quantity, unit_price, unit_cost, image_key, image_url
    )
    select gen_random_uuid()::text, v_order_id, p.id, v.id, p.name, p.slug, v.colour, v.size,
           (e ->> 'qty')::int, p.price, coalesce(p.cost_price, 0), p.image_key, coalesce(v.image_url, p.image_url)
    from jsonb_array_elements(v_lines) e
    join public.product_variants v
      on v.product_id = (e ->> 'pid') and v.colour = e ->> 'colour' and v.size = e ->> 'size'
    join public.products p on p.id = v.product_id;

    update public.product_variants v
    set stock = v.stock - (e ->> 'qty')::int
    from jsonb_array_elements(v_lines) e
    where v.product_id = (e ->> 'pid') and v.colour = e ->> 'colour' and v.size = e ->> 'size';
  exception when unique_violation then
    -- The same request was processed concurrently; return that order.
    select id, order_number, total into v_existing
    from public.orders where user_id = v_uid::text and idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    return jsonb_build_object('id', v_existing.id, 'order_number', v_existing.order_number,
                              'total', v_existing.total::numeric, 'existing', true);
  end;

  return jsonb_build_object('id', v_order_id, 'order_number', v_order_number,
                            'total', v_total, 'existing', false);
end;
$$;
revoke all on function public.create_order(jsonb, jsonb, text, text, uuid) from public, anon;
grant execute on function public.create_order(jsonb, jsonb, text, text, uuid) to authenticated;

-- ---- Customer cancellation --------------------------------------------------------------
create or replace function public.cancel_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order record;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  select id, status, payment_status into v_order
  from public.orders where id = p_order::text and user_id = v_uid::text
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ORDER_NOT_FOUND';
  end if;
  if v_order.status <> 'Processing' then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_CANCELLABLE';
  end if;
  if v_order.payment_status = 'paid' then
    -- Paid online orders need a refund; the store handles those.
    raise exception using errcode = 'P0001', message = 'ORDER_ALREADY_PAID';
  end if;
  update public.orders set status = 'Cancelled', updated_at = public.iso_utc_text(now()) where id = p_order::text;
end;
$$;
revoke all on function public.cancel_order(uuid) from public, anon;
grant execute on function public.cancel_order(uuid) to authenticated;

-- ---- Guard rails on orders ---------------------------------------------------------------
-- Applies to requests made with a browser session (roles anon/authenticated).
-- Trusted code (the functions in this file, the server's service role) passes.
create or replace function public.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'ORDER_UPDATE_NOT_ALLOWED';
  end if;
  if (new.id, new.user_id, new.order_number, new.created_at, new.subtotal, new.shipping, new.discount,
      new.total, new.cost_total, new.promo_code, new.payment_method, new.payment_status,
      new.idempotency_key, new.ship_name, new.ship_phone, new.ship_address, new.ship_city,
      new.ship_state, new.ship_pincode)
     is distinct from
     (old.id, old.user_id, old.order_number, old.created_at, old.subtotal, old.shipping, old.discount,
      old.total, old.cost_total, old.promo_code, old.payment_method, old.payment_status,
      old.idempotency_key, old.ship_name, old.ship_phone, old.ship_address, old.ship_city,
      old.ship_state, old.ship_pincode) then
    raise exception using errcode = '42501', message = 'ORDER_FIELDS_LOCKED';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'Processing' and new.status in ('Shipped', 'Cancelled'))
            or (old.status = 'Shipped' and new.status in ('Delivered', 'Cancelled'))) then
      raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
    end if;
    if new.status = 'Shipped' and old.payment_method <> 'cod' and old.payment_status <> 'paid' then
      raise exception using errcode = 'P0001', message = 'ORDER_NOT_PAID';
    end if;
  end if;
  new.updated_at := public.iso_utc_text(now());
  return new;
end;
$$;

drop trigger if exists orders_guard_before_update on public.orders;
create trigger orders_guard_before_update
  before update on public.orders
  for each row execute function public.orders_guard();

-- Stock goes back on the shelf when an order is cancelled before shipping.
create or replace function public.orders_restock_after_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'Processing' and new.status = 'Cancelled' then
    update public.product_variants v
    set stock = v.stock + i.qty
    from (
      select variant_id, sum(quantity::integer)::int as qty
      from public.order_items
      where order_id = new.id and variant_id is not null
      group by variant_id
    ) i
    where v.id = i.variant_id;
  end if;
  return null;
end;
$$;
revoke all on function public.orders_restock_after_cancel() from public, anon, authenticated;

drop trigger if exists orders_restock_after_cancel on public.orders;
create trigger orders_restock_after_cancel
  after update of status on public.orders
  for each row execute function public.orders_restock_after_cancel();

-- ---- Access rules: orders, order_items, order_payments -----------------------------------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_payments enable row level security;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated using (user_id = auth.uid()::text);
drop policy if exists orders_select_admin on public.orders;
create policy orders_select_admin on public.orders
  for select to authenticated using (public.is_admin());
drop policy if exists orders_update_admin on public.orders;
create policy orders_update_admin on public.orders
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()::text));
drop policy if exists order_items_select_admin on public.order_items;
create policy order_items_select_admin on public.order_items
  for select to authenticated using (public.is_admin());

drop policy if exists order_payments_select_own on public.order_payments;
create policy order_payments_select_own on public.order_payments
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()::text));
drop policy if exists order_payments_select_admin on public.order_payments;
create policy order_payments_select_admin on public.order_payments
  for select to authenticated using (public.is_admin());

-- Browser sessions: no inserts/deletes; updates only via the admin policy + guard.
-- Customers see every column except internal cost figures and admin notes.
revoke all on public.orders, public.order_items, public.order_payments from anon;
revoke insert, delete, truncate on public.orders from authenticated;
revoke insert, update, delete, truncate on public.order_items, public.order_payments from authenticated;
revoke select on public.orders from authenticated;
grant select (id, user_id, order_number, created_at, updated_at, status, payment_method, payment_status,
              promo_code, subtotal, shipping, discount, total, tracking_number,
              ship_name, ship_phone, ship_address, ship_city, ship_state, ship_pincode)
  on public.orders to authenticated;
-- Revoking the table-level privilege also removes column grants, so revoke first.
revoke update on public.orders from authenticated;
grant update (status, tracking_number, admin_note) on public.orders to authenticated;
revoke select on public.order_items from authenticated;
grant select (id, order_id, product_id, variant_id, product_name, product_slug, colour, size,
              quantity, unit_price, image_key, image_url)
  on public.order_items to authenticated;
grant select (id, order_id, provider, status, amount, currency, created_at) on public.order_payments to authenticated;
grant all on public.orders, public.order_items, public.order_payments to service_role;

-- ---- Payment functions (server only: service role) ---------------------------------------
-- Records the provider order created by the server for an unpaid online order.
create or replace function public.record_payment_order(
  p_order uuid, p_user uuid, p_provider_order_id text, p_amount integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  select id, user_id, status, payment_method, payment_status, total into v_order
  from public.orders where id = p_order::text for update;
  if not found or v_order.user_id is distinct from p_user::text then
    raise exception using errcode = 'P0002', message = 'ORDER_NOT_FOUND';
  end if;
  if v_order.payment_method <> 'razorpay' or v_order.status <> 'Processing' or v_order.payment_status = 'paid' then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_PAYABLE';
  end if;
  if p_amount is distinct from v_order.total::numeric * 100 then
    raise exception using errcode = 'P0001', message = 'AMOUNT_MISMATCH';
  end if;
  insert into public.order_payments (order_id, provider, provider_order_id, amount)
  values (p_order, 'razorpay', p_provider_order_id, p_amount);
end;
$$;

-- Marks the order paid once the server has verified the payment with the
-- provider. Idempotent. Returns 'paid', 'already_paid', 'order_cancelled'
-- (money received for a cancelled order: refund needed) or 'unknown_order'.
create or replace function public.mark_order_paid(
  p_provider_order_id text, p_provider_payment_id text, p_amount integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_order record;
begin
  select * into v_payment from public.order_payments
  where provider_order_id = p_provider_order_id for update;
  if not found then
    return 'unknown_order';
  end if;
  if v_payment.status in ('paid', 'paid_after_cancel') then
    return 'already_paid';
  end if;
  if p_amount is distinct from v_payment.amount then
    raise exception using errcode = 'P0001', message = 'AMOUNT_MISMATCH';
  end if;
  select id, status into v_order from public.orders where id = v_payment.order_id for update;
  if v_order.status = 'Cancelled' then
    update public.order_payments
    set status = 'paid_after_cancel', provider_payment_id = p_provider_payment_id, updated_at = now()
    where id = v_payment.id;
    return 'order_cancelled';
  end if;
  update public.order_payments
  set status = 'paid', provider_payment_id = p_provider_payment_id, updated_at = now()
  where id = v_payment.id;
  update public.orders set payment_status = 'paid', updated_at = public.iso_utc_text(now()) where id = v_order.id;
  return 'paid';
end;
$$;

create or replace function public.mark_payment_failed(p_provider_order_id text, p_provider_payment_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.order_payments
  set status = 'failed', provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id), updated_at = now()
  where provider_order_id = p_provider_order_id and status = 'created'
$$;

-- Releases stock held by online orders that were never paid.
create or replace function public.expire_unpaid_orders(p_minutes integer default 45)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.orders o
  set status = 'Cancelled', updated_at = public.iso_utc_text(now())
  where o.payment_method = 'razorpay'
    and o.status = 'Processing'
    and o.payment_status <> 'paid'
    and o.created_at < public.iso_utc_text(now() - make_interval(mins => greatest(p_minutes, 15)))
    and not exists (select 1 from public.order_payments p where p.order_id = o.id and p.status = 'paid');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.record_payment_order(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.mark_order_paid(text, text, integer) from public, anon, authenticated;
revoke all on function public.mark_payment_failed(text, text) from public, anon, authenticated;
revoke all on function public.expire_unpaid_orders(integer) from public, anon, authenticated;
grant execute on function public.record_payment_order(uuid, uuid, text, integer) to service_role;
grant execute on function public.mark_order_paid(text, text, integer) to service_role;
grant execute on function public.mark_payment_failed(text, text) to service_role;
grant execute on function public.expire_unpaid_orders(integer) to service_role;
