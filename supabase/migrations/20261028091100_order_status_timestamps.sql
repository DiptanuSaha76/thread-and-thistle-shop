-- =============================================================================
-- 13. Real shipped / delivered times for the My Orders timeline.
--
-- Adds orders.shipped_at and orders.delivered_at. They are set by the database
-- itself, at the moment an order's status actually changes to Shipped or
-- Delivered, whoever makes the change (admin panel or trusted server code). The
-- existing status rules (orders_guard) still decide whether a change is allowed;
-- this trigger runs after them and changes nothing else.
--
-- * Browsers cannot set these columns (customers and admins only have update
--   rights on status / tracking_number / admin_note).
-- * Existing orders are NOT back-filled: their real shipping and delivery times
--   were never recorded, so the page shows "Date not recorded" for them rather
--   than an invented date.
-- * Nothing here reads Shiprocket or changes an order's status.
--
-- Additive and safe to re-run.
-- =============================================================================

alter table public.orders add column if not exists shipped_at timestamptz;
alter table public.orders add column if not exists delivered_at timestamptz;

create or replace function public.orders_status_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.shipped_at := null;
    new.delivered_at := null;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'Shipped' then
      new.shipped_at := coalesce(old.shipped_at, now());
    elsif new.status = 'Delivered' then
      new.delivered_at := coalesce(old.delivered_at, now());
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.orders_status_timestamps() from public, anon, authenticated;

-- BEFORE triggers run in name order: orders_guard_before_update (status rules) runs first.
drop trigger if exists orders_status_timestamps on public.orders;
create trigger orders_status_timestamps
  before insert or update on public.orders
  for each row execute function public.orders_status_timestamps();

-- Customers may read the two new columns on their own orders (row rules unchanged).
grant select (shipped_at, delivered_at) on public.orders to authenticated;
