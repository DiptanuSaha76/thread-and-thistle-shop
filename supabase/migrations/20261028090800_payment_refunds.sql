-- =============================================================================
-- 10. Refund tracking for money collected through Razorpay.
--
-- Money that has to go back to a customer is never "lost track of":
-- * an admin cancels an order that was paid online,
-- * a payment is captured after its order was cancelled or expired, or
-- * a second successful payment arrives for an order that is already paid
--   (defensive; Razorpay's Orders API normally prevents this),
-- each create one row in public.payment_refunds, inside the same database
-- transaction as the change that caused it.
--
-- Refunds are started only by an admin, from the server, never automatically.
-- The server uses Razorpay's refund idempotency key (the row id), so a retried
-- request cannot refund twice; refunds are always for the full payment amount,
-- which Razorpay also refuses to exceed. Rows move:
--   refund_required -> refund_requested (sent; outcome not yet known)
--                   -> refund_pending (Razorpay accepted) -> refunded
--                   -> refund_failed (Razorpay refused)
--   refund_required / refund_failed -> resolved_manually (admin, with a note)
--
-- Customers still cannot cancel paid orders (public.cancel_order is unchanged).
-- Additive and safe to re-run. Replaces public.mark_order_paid() with a version
-- that keeps the same results and adds the refund records.
-- =============================================================================

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders (id) on delete restrict, -- orders.id is text
  payment_record_id uuid references public.order_payments (id) on delete restrict,
  provider text not null default 'razorpay' check (provider in ('razorpay')),
  -- One refund case per collected payment.
  provider_payment_id text not null unique check (provider_payment_id ~ '^pay_[A-Za-z0-9]+$'),
  amount integer not null check (amount > 0), -- paise; always the full payment
  currency text not null default 'INR',
  reason text not null check (reason in ('order_cancelled_after_payment', 'late_payment_after_cancel', 'duplicate_payment')),
  status text not null default 'refund_required'
    check (status in ('refund_required', 'refund_requested', 'refund_pending', 'refunded', 'refund_failed', 'resolved_manually')),
  provider_refund_id text unique check (provider_refund_id is null or provider_refund_id ~ '^rfnd_[A-Za-z0-9]+$'),
  provider_status text check (provider_status is null or provider_status in ('pending', 'processed', 'failed')),
  attempts integer not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 120),
  note text check (note is null or char_length(note) <= 500),
  requested_at timestamptz,
  requested_by uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_refunds_order_id on public.payment_refunds (order_id);
create index if not exists payment_refunds_open on public.payment_refunds (created_at)
  where status not in ('refunded', 'resolved_manually');

alter table public.payment_refunds enable row level security;
revoke all on public.payment_refunds from public, anon, authenticated;
grant select, insert, update, delete on public.payment_refunds to service_role;

-- -----------------------------------------------------------------------------
-- Cancelling an order that was paid online records the refund that is owed.
-- If a paid online order has no captured payment on record, the cancellation is
-- refused rather than losing track of the money.
-- -----------------------------------------------------------------------------
create or replace function public.orders_refund_after_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled'
     and new.payment_method = 'razorpay' and new.payment_status = 'paid' then
    insert into public.payment_refunds (order_id, payment_record_id, provider_payment_id, amount, currency, reason)
    select p.order_id, p.id, p.provider_payment_id, p.amount, p.currency, 'order_cancelled_after_payment'
    from public.order_payments p
    where p.order_id = new.id and p.status = 'paid' and p.provider_payment_id is not null
    on conflict (provider_payment_id) do nothing;
    if not exists (select 1 from public.payment_refunds r where r.order_id = new.id) then
      raise exception using errcode = 'P0001', message = 'PAID_ORDER_WITHOUT_PAYMENT_RECORD';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.orders_refund_after_cancel() from public, anon, authenticated;

drop trigger if exists orders_refund_after_cancel on public.orders;
create trigger orders_refund_after_cancel
  after update of status on public.orders
  for each row execute function public.orders_refund_after_cancel();

-- -----------------------------------------------------------------------------
-- mark_order_paid: same results as before ('paid', 'already_paid',
-- 'order_cancelled', 'unknown_order'), plus 'duplicate_payment', and it now
-- records the refund owed for late or duplicate payments.
-- -----------------------------------------------------------------------------
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
    if p_provider_payment_id is not null and v_payment.provider_payment_id is distinct from p_provider_payment_id
       and p_provider_payment_id ~ '^pay_[A-Za-z0-9]+$' and coalesce(p_amount, 0) > 0 then
      insert into public.payment_refunds (order_id, provider_payment_id, amount, currency, reason)
      values (v_payment.order_id, p_provider_payment_id, p_amount, v_payment.currency, 'duplicate_payment')
      on conflict (provider_payment_id) do nothing;
      return 'duplicate_payment';
    end if;
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
    insert into public.payment_refunds (order_id, payment_record_id, provider_payment_id, amount, currency, reason)
    values (v_payment.order_id, v_payment.id, p_provider_payment_id, v_payment.amount, v_payment.currency, 'late_payment_after_cancel')
    on conflict (provider_payment_id) do nothing;
    return 'order_cancelled';
  end if;
  update public.order_payments
  set status = 'paid', provider_payment_id = p_provider_payment_id, updated_at = now()
  where id = v_payment.id;
  update public.orders set payment_status = 'paid', updated_at = public.iso_utc_text(now()) where id = v_order.id;
  return 'paid';
end;
$$;
revoke all on function public.mark_order_paid(text, text, integer) from public, anon, authenticated;
grant execute on function public.mark_order_paid(text, text, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Refund workflow functions (server only, called after the admin check).
-- -----------------------------------------------------------------------------

-- Locks the case and marks it "requested". Returns what the server needs to
-- call Razorpay, or {"ok":false,"reason":...}. A case that is already
-- "requested" may be requested again: the same idempotency key is reused.
create or replace function public.refund_begin(p_case uuid, p_admin uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_refunds;
begin
  select * into v from public.payment_refunds where id = p_case for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v.status in ('refund_pending', 'refunded', 'resolved_manually') then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_DONE', 'status', v.status);
  end if;
  if v.status = 'refund_failed' then
    return jsonb_build_object('ok', false, 'reason', 'FAILED', 'status', v.status);
  end if;
  update public.payment_refunds
  set status = 'refund_requested', attempts = attempts + 1, requested_at = now(),
      requested_by = p_admin, updated_at = now()
  where id = p_case;
  return jsonb_build_object(
    'ok', true,
    'provider_payment_id', v.provider_payment_id,
    'amount', v.amount,
    'currency', v.currency,
    'order_id', v.order_id,
    'idempotency_key', v.id::text,
    'retry', v.status = 'refund_requested');
end;
$$;

-- Records a refund that the server has fetched from (or created at) Razorpay.
-- Full refunds only. Idempotent; a refunded case never moves backwards.
create or replace function public.refund_record(
  p_case uuid, p_refund_id text, p_amount integer, p_provider_status text, p_admin uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_refunds;
  v_status text;
begin
  if coalesce(p_refund_id, '') !~ '^rfnd_[A-Za-z0-9]+$' or p_provider_status not in ('pending', 'processed', 'failed') then
    raise exception using errcode = '22023', message = 'INVALID_REFUND';
  end if;
  select * into v from public.payment_refunds where id = p_case for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'REFUND_CASE_NOT_FOUND';
  end if;
  if v.status in ('refunded', 'resolved_manually') then
    if v.provider_refund_id = p_refund_id then
      return v.status;
    end if;
    raise exception using errcode = 'P0001', message = 'REFUND_ALREADY_RECORDED';
  end if;
  if v.status = 'refund_pending' and v.provider_refund_id <> p_refund_id then
    raise exception using errcode = 'P0001', message = 'REFUND_ALREADY_RECORDED';
  end if;
  if p_provider_status <> 'failed' and p_amount is distinct from v.amount then
    raise exception using errcode = 'P0001', message = 'REFUND_AMOUNT_MISMATCH';
  end if;
  if exists (select 1 from public.payment_refunds r where r.provider_refund_id = p_refund_id and r.id <> p_case) then
    raise exception using errcode = 'P0001', message = 'REFUND_ID_IN_USE';
  end if;
  v_status := case p_provider_status when 'processed' then 'refunded'
                                     when 'pending' then 'refund_pending'
                                     else 'refund_failed' end;
  update public.payment_refunds
  set provider_refund_id = p_refund_id,
      provider_status = p_provider_status,
      status = v_status,
      last_error = case when v_status = 'refund_failed' then 'Razorpay reported the refund as failed' end,
      resolved_at = case when v_status = 'refunded' then now() end,
      resolved_by = case when v_status = 'refunded' then p_admin end,
      updated_at = now()
  where id = p_case;
  return v_status;
end;
$$;

-- Razorpay definitely refused the refund request (not a timeout).
create or replace function public.refund_mark_failed(p_case uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_refunds
  set status = 'refund_failed', last_error = left(coalesce(p_error, 'Refused by Razorpay'), 120), updated_at = now()
  where id = p_case and status = 'refund_requested'
$$;

-- The admin refunded the customer outside Razorpay (e.g. bank transfer) and
-- closes the case with a note. Not allowed while a Razorpay refund may be in flight.
create or replace function public.refund_resolve_manually(p_case uuid, p_admin uuid, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_refunds;
begin
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception using errcode = '22023', message = 'NOTE_REQUIRED';
  end if;
  select * into v from public.payment_refunds where id = p_case for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'REFUND_CASE_NOT_FOUND';
  end if;
  if v.status not in ('refund_required', 'refund_failed') then
    raise exception using errcode = 'P0001', message = 'REFUND_NOT_RESOLVABLE';
  end if;
  update public.payment_refunds
  set status = 'resolved_manually', note = left(btrim(p_note), 500), resolved_at = now(),
      resolved_by = p_admin, updated_at = now()
  where id = p_case;
  return 'resolved_manually';
end;
$$;

revoke all on function public.refund_begin(uuid, uuid) from public, anon, authenticated;
revoke all on function public.refund_record(uuid, text, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.refund_mark_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.refund_resolve_manually(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.refund_begin(uuid, uuid) to service_role;
grant execute on function public.refund_record(uuid, text, integer, text, uuid) to service_role;
grant execute on function public.refund_mark_failed(uuid, text) to service_role;
grant execute on function public.refund_resolve_manually(uuid, uuid, text) to service_role;
