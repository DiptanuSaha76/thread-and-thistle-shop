-- =============================================================================
-- 9. Shipment tracking cache (Shiprocket, manual shipments).
--
-- The admin creates the shipment in the Shiprocket dashboard and enters its AWB
-- in the existing order "Tracking number" field (orders.tracking_number, which
-- the order guard already restricts to admins). This table only caches the
-- tracking information the website server fetched from Shiprocket for that AWB,
-- so customers opening "Track Order" do not trigger a Shiprocket call every time.
--
-- * Kept separate from public.orders: the order guard and order columns are
--   unchanged, and nothing here changes an order's status.
-- * No browser access at all. The website server reads/writes it with the
--   service role only after confirming the order belongs to the signed-in
--   customer.
--
-- Additive and safe to re-run.
-- =============================================================================

create table if not exists public.order_shipments (
  order_id text primary key references public.orders (id) on delete cascade, -- orders.id is text
  provider text not null default 'shiprocket' check (provider in ('shiprocket')),
  awb text not null check (awb ~ '^[A-Za-z0-9-]{6,40}$'),
  -- Shiprocket's own status text, shown as-is (never mapped to an order status).
  current_status text check (current_status is null or char_length(current_status) <= 120),
  estimated_delivery text check (estimated_delivery is null or char_length(estimated_delivery) <= 40),
  track_url text check (track_url is null or (char_length(track_url) <= 500 and track_url ~ '^https://')),
  -- Sanitized list of {time, activity, location}, newest first, at most 50.
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array'),
  -- 'ok' | 'no_activity' | 'not_found' | 'error'
  last_result text check (last_result is null or last_result in ('ok', 'no_activity', 'not_found', 'error')),
  last_attempt_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.order_shipments enable row level security;
revoke all on public.order_shipments from public, anon, authenticated;
grant select, insert, update, delete on public.order_shipments to service_role;
