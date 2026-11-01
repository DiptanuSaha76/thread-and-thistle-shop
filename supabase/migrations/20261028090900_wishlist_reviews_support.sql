-- =============================================================================
-- 11. Wishlist safeguards, product reviews, and contact/support messages.
--
-- * Wishlist (existing: customer_carts.wishlist, owner-only). Every save is now
--   cleaned in the database: only product ids that exist, no duplicates,
--   original order kept.
-- * Product reviews (new table public.product_reviews). Anyone can read
--   published reviews. Only a signed-in customer with a DELIVERED order that
--   contains the product can review it, once per product (submitting again
--   edits it). The name shown is taken from the customer's profile, never from
--   the browser. Admins can hide a review. The product's rating and review count
--   follow the published reviews from now on.
-- * Contact form (existing table public.support_messages, admin inbox). Browsers
--   can no longer insert directly; messages are saved by the website server
--   through submit_support_message(), which validates and rate-limits them.
--
-- Additive and safe to re-run. Existing support messages are not re-checked.
-- =============================================================================

-- ---- Wishlist ------------------------------------------------------------------------
create or replace function public.customer_carts_clean_wishlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.wishlist) is distinct from 'array' then
    new.wishlist := '[]'::jsonb;
    return new;
  end if;
  new.wishlist := coalesce((
    select jsonb_agg(to_jsonb(w.id) order by w.first_pos)
    from (
      select e.value #>> '{}' as id, min(e.pos) as first_pos
      from jsonb_array_elements(new.wishlist) with ordinality as e(value, pos)
      where jsonb_typeof(e.value) = 'string'
        and (e.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      group by 1
    ) w
    where exists (select 1 from public.products p where p.id::text = w.id)
  ), '[]'::jsonb);
  return new;
end;
$$;
revoke all on function public.customer_carts_clean_wishlist() from public, anon, authenticated;

drop trigger if exists customer_carts_clean_wishlist on public.customer_carts;
create trigger customer_carts_clean_wishlist
  before insert or update of wishlist on public.customer_carts
  for each row execute function public.customer_carts_clean_wishlist();

-- ---- Product reviews -----------------------------------------------------------------
create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key: public.products.id has no primary key or unique constraint on the live
  -- project. submit_product_review() checks that the product exists.
  product_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  title text not null default '' check (char_length(title) <= 60),
  body text not null check (char_length(btrim(body)) between 3 and 400),
  display_name text not null check (char_length(display_name) between 1 and 60),
  verified_purchase boolean not null default true,
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, user_id)
);
create index if not exists product_reviews_product on public.product_reviews (product_id, created_at desc)
  where status = 'published';

alter table public.product_reviews enable row level security;
drop policy if exists product_reviews_select_published on public.product_reviews;
create policy product_reviews_select_published on public.product_reviews
  for select to anon, authenticated using (status = 'published');
revoke all on public.product_reviews from public, anon, authenticated;
-- Public columns only: who wrote it (user_id) and moderation fields stay private.
grant select (id, product_id, rating, title, body, display_name, verified_purchase, created_at)
  on public.product_reviews to anon, authenticated;
grant all on public.product_reviews to service_role;

-- Write or edit your own review of a product you have received.
create or replace function public.submit_product_review(
  p_product uuid, p_rating integer, p_title text, p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_first text;
  v_last text;
  v_name text;
  v_row public.product_reviews;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception using errcode = '22023', message = 'INVALID_RATING';
  end if;
  if char_length(v_title) > 60 or v_title ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'INVALID_TITLE';
  end if;
  if char_length(v_body) not between 3 and 400 or v_body ~ '[\x01-\x09\x0b-\x1f\x7f]' then
    raise exception using errcode = '22023', message = 'INVALID_REVIEW';
  end if;
  if not exists (select 1 from public.products where id = p_product::text) then
    raise exception using errcode = 'P0002', message = 'PRODUCT_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.orders o join public.order_items i on i.order_id = o.id
    where o.user_id = v_uid::text and o.status = 'Delivered' and i.product_id = p_product::text
  ) then
    raise exception using errcode = 'P0001', message = 'NOT_PURCHASED';
  end if;

  select btrim(first_name), btrim(last_name) into v_first, v_last from public.profiles where id = v_uid::text;
  v_name := left(btrim(concat_ws(' ', nullif(v_first, ''),
                                 case when coalesce(v_last, '') <> '' then left(v_last, 1) || '.' end)), 60);
  if coalesce(v_name, '') = '' then
    v_name := 'Customer';
  end if;

  insert into public.product_reviews (product_id, user_id, rating, title, body, display_name)
  values (p_product, v_uid, p_rating, v_title, v_body, v_name)
  on conflict (product_id, user_id) do update
    set rating = excluded.rating, title = excluded.title, body = excluded.body,
        display_name = excluded.display_name, updated_at = now()
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;
revoke all on function public.submit_product_review(uuid, integer, text, text) from public, anon;
grant execute on function public.submit_product_review(uuid, integer, text, text) to authenticated;

-- Whether the signed-in customer may review a product (for the page), without revealing anything else.
create or replace function public.can_review_product(p_product uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.orders o join public.order_items i on i.order_id = o.id
    where o.user_id = auth.uid()::text and o.status = 'Delivered' and i.product_id = p_product::text)
$$;
revoke all on function public.can_review_product(uuid) from public, anon;
grant execute on function public.can_review_product(uuid) to authenticated;

-- The product's rating and review count follow its published reviews.
create or replace function public.product_reviews_refresh_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product text := coalesce(new.product_id, old.product_id);
begin
  update public.products p
  set rating = coalesce(s.avg_rating, 0), review_count = s.n
  from (
    select round(avg(rating)::numeric, 1) as avg_rating, count(*)::int as n
    from public.product_reviews where product_id = v_product and status = 'published'
  ) s
  where p.id = v_product;
  return null;
end;
$$;
revoke all on function public.product_reviews_refresh_rating() from public, anon, authenticated;

drop trigger if exists product_reviews_refresh_rating on public.product_reviews;
create trigger product_reviews_refresh_rating
  after insert or update of rating, status or delete on public.product_reviews
  for each row execute function public.product_reviews_refresh_rating();

-- ---- Contact / support messages --------------------------------------------------------
alter table public.support_messages add column if not exists ip_hash text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_messages_format'
                   and conrelid = 'public.support_messages'::regclass) then
    alter table public.support_messages add constraint support_messages_format check (
      char_length(btrim(name)) between 1 and 100
      and char_length(email) between 3 and 255
      and char_length(btrim(topic)) between 1 and 60
      and char_length(btrim(message)) between 1 and 4000
      and status in ('open', 'resolved')
      and (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$')
    ) not valid;
  end if;
end $$;
create index if not exists support_messages_ip_recent on public.support_messages (ip_hash, created_at desc)
  where ip_hash is not null;
create index if not exists support_messages_email_recent on public.support_messages (lower(email), created_at desc);

-- Browsers no longer insert directly (any legacy "anyone may insert" policy becomes inert).
revoke insert on public.support_messages from anon, authenticated;

-- Saves a contact message. Called only by the website server.
-- Limits: 5 per hour per IP address, 5 per hour per email, 200 per hour overall.
create or replace function public.submit_support_message(
  p_name text, p_email text, p_topic text, p_message text, p_user uuid, p_ip_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_topic text := btrim(coalesce(p_topic, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_id uuid;
begin
  if char_length(v_name) not between 1 and 100 or v_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'INVALID_NAME';
  end if;
  if char_length(v_email) > 255 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception using errcode = '22023', message = 'INVALID_EMAIL';
  end if;
  if v_topic not in ('Product & sizing', 'My order', 'Returns & exchanges', 'Something else') then
    raise exception using errcode = '22023', message = 'INVALID_TOPIC';
  end if;
  if char_length(v_message) not between 10 and 4000 then
    raise exception using errcode = '22023', message = 'INVALID_MESSAGE';
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;
  if (p_ip_hash is not null and (select count(*) from public.support_messages
        where ip_hash = p_ip_hash and created_at > public.iso_utc_text(now() - interval '1 hour')) >= 5)
     or (select count(*) from public.support_messages
        where lower(email) = v_email and created_at > public.iso_utc_text(now() - interval '1 hour')) >= 5
     or (select count(*) from public.support_messages where created_at > public.iso_utc_text(now() - interval '1 hour')) >= 200 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;
  -- support_messages.id has no default on the live project: the id is created here.
  v_id := gen_random_uuid();
  insert into public.support_messages (id, created_at, name, email, topic, message, user_id, ip_hash, status)
  values (v_id::text, public.iso_utc_text(now()), v_name, v_email, v_topic, v_message, p_user, p_ip_hash, 'open');
  return v_id;
end;
$$;
revoke all on function public.submit_support_message(text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_support_message(text, text, text, text, uuid, text) to service_role;
