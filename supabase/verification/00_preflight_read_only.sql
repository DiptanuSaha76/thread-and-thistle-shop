-- =============================================================================
-- PRE-FLIGHT CHECK (READ-ONLY). Run in the Supabase SQL editor BEFORE applying
-- the migrations in supabase/migrations/. Every section is a single SELECT and
-- changes nothing. Run the sections one at a time (the SQL editor shows only the
-- last result) and compare each result with the expectation in its comment.
--
-- Order matters: if section 2 shows a missing table, or section 3 a missing
-- column, stop there. Later sections read those tables, and their results only
-- mean something once sections 2 and 3 are clean.
-- =============================================================================

-- 1. Which project is this? Compare with the Reference ID in
--    Project Settings -> General and with the host in VITE_SUPABASE_URL.
select current_database() as database, now() as checked_at;

-- 2. Tables the migrations read or change.
--    EXPECT: every row exists = true. FAIL: any false -> stop; do not apply.
select t.name, to_regclass(t.name) is not null as exists
from (values ('public.profiles'), ('public.yearth_profiles'), ('public.yearth_addresses'),
             ('public.yearth_account_preferences'), ('public.user_roles'), ('public.products'),
             ('public.product_variants'), ('public.promo_codes'), ('public.store_settings'),
             ('public.orders'), ('public.order_items'), ('public.support_messages'),
             ('auth.users'), ('storage.buckets'), ('storage.objects')) as t(name)
order by 1;

-- 3. Columns the migrations read, write, compare or grant.
--    EXPECT: no rows. FAIL: any row = a missing column -> stop; do not apply.
with expected(table_schema, table_name, column_name) as (values
  ('public','profiles','id'), ('public','profiles','name'), ('public','profiles','email'),
  ('public','profiles','first_name'), ('public','profiles','last_name'), ('public','profiles','phone'),
  ('public','yearth_profiles','user_id'), ('public','yearth_profiles','full_name'), ('public','yearth_profiles','phone'),
  ('public','yearth_addresses','id'), ('public','yearth_addresses','user_id'), ('public','yearth_addresses','label'),
  ('public','yearth_addresses','full_name'), ('public','yearth_addresses','phone'), ('public','yearth_addresses','line1'),
  ('public','yearth_addresses','line2'), ('public','yearth_addresses','city'), ('public','yearth_addresses','state'),
  ('public','yearth_addresses','pincode'), ('public','yearth_addresses','is_default'),
  ('public','yearth_account_preferences','user_id'),
  ('public','user_roles','user_id'), ('public','user_roles','role'),
  ('public','products','id'), ('public','products','active'), ('public','products','badge'), ('public','products','category'),
  ('public','products','compare_at_price'), ('public','products','cost_price'), ('public','products','created_at'),
  ('public','products','description'), ('public','products','details'), ('public','products','image_key'),
  ('public','products','image_url'), ('public','products','images'), ('public','products','name'),
  ('public','products','price'), ('public','products','primary_colour'), ('public','products','rating'),
  ('public','products','review_count'), ('public','products','slug'), ('public','products','sort_order'),
  ('public','products','updated_at'),
  ('public','product_variants','id'), ('public','product_variants','product_id'), ('public','product_variants','colour'),
  ('public','product_variants','size'), ('public','product_variants','stock'), ('public','product_variants','image_url'),
  ('public','promo_codes','code'), ('public','promo_codes','percent'), ('public','promo_codes','active'),
  ('public','store_settings','id'), ('public','store_settings','cod_enabled'), ('public','store_settings','razorpay_enabled'),
  ('public','store_settings','free_shipping_threshold'), ('public','store_settings','shipping_fee'),
  ('public','orders','id'), ('public','orders','user_id'), ('public','orders','order_number'), ('public','orders','created_at'),
  ('public','orders','updated_at'), ('public','orders','status'), ('public','orders','payment_method'),
  ('public','orders','payment_status'), ('public','orders','promo_code'), ('public','orders','subtotal'),
  ('public','orders','shipping'), ('public','orders','discount'), ('public','orders','total'), ('public','orders','cost_total'),
  ('public','orders','admin_note'), ('public','orders','tracking_number'), ('public','orders','ship_name'),
  ('public','orders','ship_phone'), ('public','orders','ship_address'), ('public','orders','ship_city'),
  ('public','orders','ship_state'), ('public','orders','ship_pincode'),
  ('public','order_items','id'), ('public','order_items','order_id'), ('public','order_items','product_id'),
  ('public','order_items','variant_id'), ('public','order_items','product_name'), ('public','order_items','product_slug'),
  ('public','order_items','colour'), ('public','order_items','size'), ('public','order_items','quantity'),
  ('public','order_items','unit_price'), ('public','order_items','unit_cost'), ('public','order_items','image_key'),
  ('public','order_items','image_url'),
  ('public','support_messages','id'), ('public','support_messages','created_at'), ('public','support_messages','name'),
  ('public','support_messages','email'), ('public','support_messages','topic'), ('public','support_messages','message'),
  ('public','support_messages','status'), ('public','support_messages','user_id'),
  ('auth','users','id'), ('auth','users','email'), ('auth','users','raw_user_meta_data'),
  ('storage','buckets','id'), ('storage','buckets','name'), ('storage','buckets','public'),
  ('storage','buckets','file_size_limit'), ('storage','buckets','allowed_mime_types'),
  ('storage','objects','bucket_id'))
select e.* from expected e
where not exists (
  select 1 from pg_attribute a
  where a.attrelid = to_regclass(e.table_schema || '.' || e.table_name)
    and a.attname = e.column_name and a.attnum > 0 and not a.attisdropped)
order by 1, 2, 3;

-- 4. Column types the migrations are written for (the confirmed live types, plus
--    other types the same SQL also works with).
--    EXPECT: no rows. FAIL: any row = the migrations would fail at push or at
--    runtime with that type -> stop and review. (Missing columns are reported by
--    section 3, not here.)
with expected(table_schema, table_name, column_name, works_with) as (values
  -- ids stored or compared as text
  ('public','user_roles','user_id',           array['text','character varying']),
  ('public','profiles','id',                  array['text','character varying']),
  ('public','orders','id',                    array['text','character varying']),
  ('public','orders','user_id',               array['text','character varying']),
  ('public','order_items','id',               array['text','character varying']),
  ('public','order_items','order_id',         array['text','character varying']),
  ('public','order_items','product_id',       array['text','character varying']),
  ('public','order_items','variant_id',       array['text','character varying']),
  ('public','products','id',                  array['text','character varying']),
  ('public','product_variants','id',          array['text','character varying']),
  ('public','product_variants','product_id',  array['text','character varying']),
  ('public','support_messages','id',          array['text','character varying']),
  ('public','support_messages','user_id',     array['text','character varying','uuid']),
  -- ids compared with auth.uid() or uuid parameters as they are
  ('public','yearth_addresses','id',          array['uuid']),
  ('public','yearth_addresses','user_id',     array['uuid']),
  ('public','yearth_account_preferences','user_id', array['uuid']),
  ('public','yearth_profiles','user_id',      array['uuid','text','character varying']),
  ('auth','users','id',                       array['uuid']),
  -- dates written as ISO text and compared as text
  ('public','orders','created_at',            array['text','character varying']),
  ('public','orders','updated_at',            array['text','character varying']),
  ('public','support_messages','created_at',  array['text','character varying']),
  ('public','orders','order_number',          array['text','character varying']),
  -- order amounts: written as whole numbers, read with ::numeric / ::integer
  ('public','orders','subtotal',              array['text','character varying','integer','bigint','numeric']),
  ('public','orders','shipping',              array['text','character varying','integer','bigint','numeric']),
  ('public','orders','discount',              array['text','character varying','integer','bigint','numeric']),
  ('public','orders','total',                 array['text','character varying','integer','bigint','numeric']),
  ('public','orders','cost_total',            array['text','character varying','integer','bigint','numeric']),
  ('public','order_items','quantity',         array['text','character varying','integer','bigint','smallint']),
  ('public','order_items','unit_price',       array['text','character varying','integer','bigint','numeric']),
  ('public','order_items','unit_cost',        array['text','character varying','integer','bigint','numeric']),
  -- numbers used in arithmetic or compared with numbers
  ('public','products','price',               array['integer','bigint','smallint','numeric']),
  ('public','products','cost_price',          array['integer','bigint','smallint','numeric']),
  ('public','products','rating',              array['integer','bigint','smallint','numeric','real','double precision']),
  ('public','products','review_count',        array['integer','bigint','smallint','numeric']),
  ('public','product_variants','stock',       array['integer','bigint','smallint','numeric']),
  ('public','store_settings','id',            array['integer','bigint','smallint','numeric']),
  ('public','store_settings','free_shipping_threshold', array['integer','bigint','smallint','numeric']),
  ('public','store_settings','shipping_fee',  array['integer','bigint','smallint','numeric']),
  -- booleans used directly in conditions
  ('public','products','active',              array['boolean']),
  ('public','store_settings','cod_enabled',   array['boolean']),
  ('public','store_settings','razorpay_enabled', array['boolean']),
  ('public','yearth_addresses','is_default',  array['boolean']),
  -- text read with btrim(), regular expressions or char_length()
  ('public','promo_codes','code',             array['text','character varying']),
  ('public','promo_codes','percent',          array['text','character varying']),
  ('public','promo_codes','active',           array['text','character varying']),
  ('public','profiles','name',                array['text','character varying']),
  ('public','profiles','email',               array['text','character varying']),
  ('public','profiles','first_name',          array['text','character varying']),
  ('public','profiles','last_name',           array['text','character varying']),
  ('public','profiles','phone',               array['text','character varying']),
  ('public','orders','status',                array['text','character varying']),
  ('public','orders','payment_method',        array['text','character varying']),
  ('public','orders','payment_status',        array['text','character varying']),
  ('public','product_variants','colour',      array['text','character varying']),
  ('public','product_variants','size',        array['text','character varying']),
  ('public','support_messages','name',        array['text','character varying']),
  ('public','support_messages','email',       array['text','character varying']),
  ('public','support_messages','topic',       array['text','character varying']),
  ('public','support_messages','message',     array['text','character varying']),
  ('public','support_messages','status',      array['text','character varying']),
  ('public','yearth_addresses','label',       array['text','character varying']),
  ('public','yearth_addresses','full_name',   array['text','character varying']),
  ('public','yearth_addresses','phone',       array['text','character varying']),
  ('public','yearth_addresses','line1',       array['text','character varying']),
  ('public','yearth_addresses','line2',       array['text','character varying']),
  ('public','yearth_addresses','city',        array['text','character varying']),
  ('public','yearth_addresses','state',       array['text','character varying']),
  ('public','yearth_addresses','pincode',     array['text','character varying']))
select e.table_schema, e.table_name, e.column_name, format_type(a.atttypid, null) as live_type,
       array_to_string(e.works_with, ' / ') as migrations_work_with
from expected e
join pg_attribute a
  on a.attrelid = to_regclass(e.table_schema || '.' || e.table_name)
 and a.attname = e.column_name and a.attnum > 0 and not a.attisdropped
where format_type(a.atttypid, null) <> all (e.works_with)
order by 1, 2, 3;

-- 5. Product columns that become hidden from browser sessions. Migration
--    ...090400 lets anon/authenticated read only a fixed list of product columns.
--    EXPECT: one row, cost_price (hidden on purpose). REVIEW: any other row is a
--    column browsers can no longer read. The storefront and admin panel read
--    products on the server with the service role, which is not affected.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'products'
  and column_name not in ('id', 'active', 'badge', 'category', 'compare_at_price', 'created_at', 'description',
                          'details', 'image_key', 'image_url', 'images', 'name', 'price', 'primary_colour',
                          'rating', 'review_count', 'slug', 'sort_order', 'updated_at')
order by ordinal_position;

-- 6. Existing policies (for your records). The migrations add policies and do not
--    drop these; write policies on orders, order_items, profiles and promo_codes
--    become inert because the matching table privileges are removed.
--    REVIEW only. Policies whose NAMES the migrations reuse are listed in section 11.
select schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')
order by 1, 2, 3;

-- 7. Existing triggers on public and auth tables.
--    EXPECT: no row with table_name orders or order_items AND touches_stock = true
--    (migration ...090300 refuses to run if one exists, to avoid adjusting stock twice).
--    REVIEW: any trigger on auth.users that also creates profiles (harmless: the new
--    one uses ON CONFLICT DO NOTHING, but both would run).
select n.nspname as schema_name, c.relname as table_name, t.tgname as trigger_name, p.proname as function_name,
       p.prosrc ilike '%product_variants%' as touches_stock
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal and n.nspname in ('public', 'auth')
order by 1, 2, 3;

-- 8. CHECK constraints on tables the migrations write to.
--    REVIEW: none may reject what the migrations write:
--      orders: status Processing/Shipped/Delivered/Cancelled, payment_status pending/paid,
--              payment_method cod/razorpay, amounts as whole-number text ('1438'),
--              created_at/updated_at as ISO text ('2026-10-28T18:03:38.175Z'),
--              order_number 'YE' + number;
--      order_items: quantity/unit_price/unit_cost as whole-number text;
--      support_messages: status 'open', created_at ISO text;
--      promo_codes: code 'YEARTH10', percent '10', active 'true';
--      profiles: phone '' or E.164; product_variants: stock >= 0.
--    FAIL: a constraint that would reject any of these.
select c.conrelid::regclass as table_name, c.conname as constraint_name,
       pg_get_constraintdef(c.oid) as definition, c.convalidated as validated
from pg_constraint c
where c.contype = 'c'
  and c.conrelid in (select to_regclass(x) from unnest(array['public.orders', 'public.order_items',
                       'public.support_messages', 'public.promo_codes', 'public.profiles',
                       'public.products', 'public.product_variants']) as x)
order by 1, 2;

-- 9. promo_codes: (a) is there a single-column unique key on code, (b) does YEARTH10 exist?
--    (a) code_has_unique_key / code_unique_key_names: INFORMATIONAL. The migrations do
--        not need it (YEARTH10 is added with WHERE NOT EXISTS, and check_promo_code()
--        reads one row with LIMIT 1). Without it, two rows could hold the same code.
--        A case-insensitive index on upper(code) is not counted here.
--    (b) yearth10_exists: EXPECT false (promo_codes is empty); the migration adds it.
--        If true, the existing row is kept unchanged.
select
  exists (
    select 1
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = to_regclass('public.promo_codes')
      and i.indisunique and i.indnkeyatts = 1 and i.indexprs is null and i.indpred is null
      and a.attname = 'code'
  ) as code_has_unique_key,
  (select string_agg(ci.relname || coalesce(' (constraint ' || con.conname || ')', ' (index)'), ', ')
     from pg_index i
     join pg_class ci on ci.oid = i.indexrelid
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
     left join pg_constraint con on con.conindid = i.indexrelid
    where i.indrelid = to_regclass('public.promo_codes')
      and i.indisunique and i.indnkeyatts = 1 and i.indexprs is null and i.indpred is null
      and a.attname = 'code') as code_unique_key_names,
  exists (select 1 from public.promo_codes t
           where upper(btrim(to_jsonb(t) ->> 'code')) = 'YEARTH10') as yearth10_exists;

-- 10. Store settings row used for shipping and payment rules.
--    EXPECT: settings_rows = 1, rows_with_id_1 = 1 (create_order reads id = 1 and
--    refuses orders with STORE_NOT_CONFIGURED otherwise).
--    id_has_unique_key: INFORMATIONAL - not needed by the migrations; the admin panel's
--    "save settings" (upsert of id 1) needs it.
select
  (select count(*) from public.store_settings) as settings_rows,
  (select count(*) from public.store_settings t where to_jsonb(t) ->> 'id' = '1') as rows_with_id_1,
  (select jsonb_build_object('cod_enabled', to_jsonb(t) -> 'cod_enabled',
                             'razorpay_enabled', to_jsonb(t) -> 'razorpay_enabled',
                             'free_shipping_threshold', to_jsonb(t) -> 'free_shipping_threshold',
                             'shipping_fee', to_jsonb(t) -> 'shipping_fee')
     from public.store_settings t where to_jsonb(t) ->> 'id' = '1' limit 1) as settings_row_1,
  exists (
    select 1
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = to_regclass('public.store_settings')
      and i.indisunique and i.indnkeyatts = 1 and i.indexprs is null and i.indpred is null
      and a.attname = 'id'
  ) as id_has_unique_key;

-- 11. Objects the migrations create that already exist.
--    EXPECT: no rows (the failed first push left nothing behind). Each row says what
--    the migrations would do with it. FAIL: any row except the legacy functions
--    (place_order, cancel_my_order, validate_promo) -> review before applying.
--    After a successful push this section lists everything; run it only before.
with found(kind, name, effect) as (
  select 'column', x.t || '.' || x.c, 'kept as it is (add column if not exists); its type may differ'
  from (values ('profiles','phone_country'), ('profiles','updated_at'), ('profiles','phone_verified_at'),
               ('orders','idempotency_key'), ('orders','shipped_at'), ('orders','delivered_at'),
               ('support_messages','ip_hash')) as x(t, c)
  where exists (select 1 from pg_attribute a
                 where a.attrelid = to_regclass('public.' || x.t) and a.attname = x.c
                   and a.attnum > 0 and not a.attisdropped)
  union all
  select 'table', 'public.' || t, 'kept as it is (create table if not exists); its shape may differ'
  from unnest(array['disposable_email_domains', 'allowed_email_domains', 'customer_carts', 'order_payments',
                    'phone_verification_challenges', 'order_shipments', 'payment_refunds', 'product_reviews']) as t
  where to_regclass('public.' || t) is not null
  union all
  select 'sequence or index', 'public.' || r, 'kept as it is (if not exists); its definition may differ'
  from unnest(array['order_number_seq', 'orders_user_idempotency_key',
                    'support_messages_ip_recent', 'support_messages_email_recent']) as r
  where to_regclass('public.' || r) is not null
  union all
  select 'constraint', con.conrelid::regclass::text || ': ' || con.conname,
         'existing one kept; profiles_id_key / product_variants_product_colour_size_key can make the push fail'
  from pg_constraint con
  where con.connamespace = 'public'::regnamespace
    and con.conname in ('profiles_phone_e164', 'profiles_id_key', 'yearth_addresses_format',
                        'product_variants_stock_non_negative', 'support_messages_format',
                        'product_variants_product_colour_size_key')
  union all
  select 'trigger', c.relname || ': ' || t.tgname,
         case when t.tgname = 'on_auth_user_admin' then 'removed (email-based admin trigger)' else 'replaced' end
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal
    and t.tgname in ('on_auth_user_admin', 'on_auth_user_created_profile', 'on_auth_user_email_changed',
                     'orders_guard_before_update', 'orders_restock_after_cancel', 'orders_refund_after_cancel',
                     'orders_status_timestamps', 'profiles_phone_verification_reset',
                     'customer_carts_clean_wishlist', 'product_reviews_refresh_rating')
  union all
  select 'policy', p.schemaname || '.' || p.tablename || ': ' || p.policyname,
         'replaced if it is on the same table (dropped and re-created by name)'
  from pg_policies p
  where p.policyname in ('profiles_select_own', 'profiles_select_admin',
      'addresses_select_own', 'addresses_insert_own', 'addresses_update_own', 'addresses_delete_own',
      'preferences_select_own', 'preferences_insert_own', 'preferences_update_own',
      'carts_select_own', 'carts_insert_own', 'carts_update_own', 'carts_delete_own',
      'orders_select_own', 'orders_select_admin', 'orders_update_admin',
      'order_items_select_own', 'order_items_select_admin',
      'order_payments_select_own', 'order_payments_select_admin',
      'products_select_active', 'products_select_admin', 'products_insert_admin', 'products_update_admin',
      'variants_select_all', 'variants_insert_admin', 'variants_update_admin',
      'settings_select_all', 'settings_insert_admin', 'settings_update_admin',
      'support_select_admin', 'support_update_admin', 'product_reviews_select_published',
      'product_images_writes_admin_only_insert', 'product_images_writes_admin_only_update',
      'product_images_writes_admin_only_delete', 'product_images_no_anon_insert',
      'product_images_no_anon_update', 'product_images_no_anon_delete', 'product_images_admin_insert',
      'product_images_admin_select', 'product_images_admin_update', 'product_images_admin_delete')
  union all
  select 'function', p.oid::regprocedure::text,
         case when p.proname in ('place_order', 'cancel_my_order', 'validate_promo')
              then 'legacy: browser access removed by ...090500 (expected if present)'
              else 'replaced (create or replace); the push fails if its return type differs' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'place_order', 'cancel_my_order', 'validate_promo',
    'is_valid_person_name', 'is_valid_mobile', 'is_admin', 'profile_is_complete', 'handle_new_user_profile',
    'sync_profile_email', 'ensure_my_profile', 'save_my_profile', 'email_domain_is_disposable',
    'check_signup_email', 'hook_before_user_created', 'set_default_address', 'iso_utc_text',
    'check_promo_code', 'create_order', 'cancel_order', 'orders_guard', 'orders_restock_after_cancel',
    'record_payment_order', 'mark_order_paid', 'mark_payment_failed', 'expire_unpaid_orders',
    'profiles_phone_verification_reset', 'phone_otp_begin', 'phone_otp_mark_sent', 'phone_otp_verify',
    'phone_otp_status', 'orders_refund_after_cancel', 'refund_begin', 'refund_record', 'refund_mark_failed',
    'refund_resolve_manually', 'customer_carts_clean_wishlist', 'submit_product_review', 'can_review_product',
    'product_reviews_refresh_rating', 'submit_support_message', 'orders_status_timestamps')
)
select kind, name, effect from found order by 1, 2;

-- 12. NOT NULL columns without a default that the migrations' inserts leave empty.
--    EXPECT: no rows. FAIL: any row = that insert fails (an order, an order line, a
--    contact message, a profile back-fill/sign-up, or the YEARTH10 promo row).
with filled(table_name, column_name) as (values
  ('orders','id'), ('orders','order_number'), ('orders','created_at'), ('orders','updated_at'), ('orders','user_id'),
  ('orders','status'), ('orders','payment_method'), ('orders','payment_status'), ('orders','promo_code'),
  ('orders','ship_name'), ('orders','ship_phone'), ('orders','ship_address'), ('orders','ship_city'),
  ('orders','ship_state'), ('orders','ship_pincode'), ('orders','subtotal'), ('orders','shipping'),
  ('orders','discount'), ('orders','total'), ('orders','cost_total'),
  ('order_items','id'), ('order_items','order_id'), ('order_items','product_id'), ('order_items','variant_id'),
  ('order_items','product_name'), ('order_items','product_slug'), ('order_items','colour'), ('order_items','size'),
  ('order_items','quantity'), ('order_items','unit_price'), ('order_items','unit_cost'),
  ('order_items','image_key'), ('order_items','image_url'),
  ('support_messages','id'), ('support_messages','created_at'), ('support_messages','name'),
  ('support_messages','email'), ('support_messages','topic'), ('support_messages','message'),
  ('support_messages','user_id'), ('support_messages','status'),
  -- the profile back-fill and ensure_my_profile() fill only these three
  ('profiles','id'), ('profiles','email'), ('profiles','name'),
  ('promo_codes','code'), ('promo_codes','percent'), ('promo_codes','active'))
select c.table_name, c.column_name, c.data_type
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('orders', 'order_items', 'support_messages', 'profiles', 'promo_codes')
  and c.is_nullable = 'NO' and c.column_default is null
  and c.is_identity = 'NO' and c.is_generated = 'NEVER'
  and (c.table_name, c.column_name) not in (select table_name, column_name from filled)
order by 1, 2;

-- 13. Data the migrations rely on (one row, counts only, no values shown).
--    EXPECT 0: orders_rows, order_items_rows (order numbers start at YE1001 and the
--      new order code writes amounts/dates as text; existing orders are not handled);
--      profiles_repeated_id (the new unique key on profiles.id);
--      repeated_product_sizes (the new unique key on (product_id, colour, size));
--      products_empty_id, sizes_empty_id (rows with no id cannot be ordered);
--      ids_not_lowercase_uuid (ids are compared with auth.uid()::text, which is
--      lowercase); admin_role_other_spelling (is_admin() matches exactly 'admin').
--    INFORMATIONAL: profiles_empty_id (allowed by the unique key, but such rows belong
--      to no user), products_repeated_id, sizes_repeated_id, support_empty_id
--      (existing messages the admin panel cannot mark resolved), admin_role_rows
--      (compare with your count: 2).
--    FAIL: any "EXPECT 0" value above 0 -> do not apply; send the result for review.
select
  (select count(*) from public.orders) as orders_rows,
  (select count(*) from public.order_items) as order_items_rows,
  (select count(*) from public.profiles t where to_jsonb(t) ->> 'id' is null) as profiles_empty_id,
  (select count(*) from (select to_jsonb(t) ->> 'id' as id from public.profiles t
                          where to_jsonb(t) ->> 'id' is not null
                          group by 1 having count(*) > 1) d) as profiles_repeated_id,
  (select count(*) from (select to_jsonb(t) ->> 'product_id' as product_id, to_jsonb(t) ->> 'colour' as colour,
                                to_jsonb(t) ->> 'size' as size
                           from public.product_variants t
                          where to_jsonb(t) ->> 'product_id' is not null and to_jsonb(t) ->> 'colour' is not null
                            and to_jsonb(t) ->> 'size' is not null
                          group by 1, 2, 3 having count(*) > 1) d) as repeated_product_sizes,
  (select count(*) from public.products t where to_jsonb(t) ->> 'id' is null) as products_empty_id,
  (select count(*) from public.product_variants t where to_jsonb(t) ->> 'id' is null) as sizes_empty_id,
  (select count(*) from (
      select to_jsonb(t) ->> 'id' as v from public.profiles t
      union all select to_jsonb(t) ->> 'user_id' from public.user_roles t
      union all select to_jsonb(t) ->> 'id' from public.products t
      union all select to_jsonb(t) ->> 'id' from public.product_variants t
      union all select to_jsonb(t) ->> 'product_id' from public.product_variants t) x
    where x.v !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as ids_not_lowercase_uuid,
  (select count(*) from public.user_roles t
    where lower(btrim(to_jsonb(t) ->> 'role')) = 'admin' and to_jsonb(t) ->> 'role' <> 'admin') as admin_role_other_spelling,
  (select count(*) from (select to_jsonb(t) ->> 'id' as id from public.products t
                          where to_jsonb(t) ->> 'id' is not null
                          group by 1 having count(*) > 1) d) as products_repeated_id,
  (select count(*) from (select to_jsonb(t) ->> 'id' as id from public.product_variants t
                          where to_jsonb(t) ->> 'id' is not null
                          group by 1 having count(*) > 1) d) as sizes_repeated_id,
  (select count(*) from public.support_messages t where to_jsonb(t) ->> 'id' is null) as support_empty_id,
  (select count(*) from public.user_roles t where to_jsonb(t) ->> 'role' = 'admin') as admin_role_rows;

-- 14. Date formats and environment (one row).
--    Contact-message dates: new messages are written as ISO UTC text
--    ('2026-10-28T18:03:38.175Z') and the hourly limit compares dates as text.
--      EXPECT support_dates_other_format = 0. If above 0, those older messages are
--      miscounted by the hourly limit and may sort out of order in the admin inbox
--      (nothing fails). support_dates_empty: INFORMATIONAL.
--    Environment: EXPECT postgres_major >= 13 and has_gen_random_uuid, has_auth_uid,
--      has_role_exists, required_roles_exist all true. FAIL: any false -> do not apply.
--    (The product-images bucket itself is checked by 40_product_images_storage_read_only.sql.)
select
  (select count(*) from public.support_messages t
    where to_jsonb(t) ->> 'created_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$') as support_dates_iso_utc,
  (select count(*) from public.support_messages t
    where to_jsonb(t) ->> 'created_at' is not null
      and to_jsonb(t) ->> 'created_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$') as support_dates_other_format,
  (select count(*) from public.support_messages t where to_jsonb(t) ->> 'created_at' is null) as support_dates_empty,
  current_setting('server_version_num')::int / 10000 as postgres_major,
  to_regprocedure('pg_catalog.gen_random_uuid()') is not null as has_gen_random_uuid,
  to_regprocedure('auth.uid()') is not null as has_auth_uid,
  to_regprocedure('public.has_role(uuid,text)') is not null as has_role_exists,
  (select count(*) from pg_roles
    where rolname in ('anon', 'authenticated', 'service_role', 'supabase_auth_admin')) = 4 as required_roles_exist;

-- 15. Privileges the migrations need, for the role running this check. Run it as the
--    same role `supabase db push` uses (in the SQL editor: current_user below).
--    can = true is needed for every row EXCEPT storage.objects, where false is the
--    normal Supabase setup and CREATE POLICY then depends on Supabase's own policy
--    permissions (not visible here) -> verify separately before pushing ...091000.
--    storage.buckets rows: false insert/update together with bypasses_rls = false and
--    no matching bucket policies means the bucket insert fails and the limit update
--    silently changes nothing.
select x.object, x.owner, x.can, current_user as checked_as
from (
  select c.oid::regclass::text as object, pg_get_userbyid(c.relowner)::text as owner,
         pg_has_role(current_user, c.relowner, 'USAGE') as can
  from pg_class c
  where c.oid in (select to_regclass(t) from unnest(array['public.profiles', 'public.orders', 'public.order_items',
                    'public.products', 'public.product_variants', 'public.support_messages', 'public.promo_codes',
                    'public.store_settings', 'public.user_roles', 'public.yearth_addresses',
                    'public.yearth_account_preferences', 'storage.objects']) as t)
  union all select 'auth.users: create trigger', null, has_table_privilege(current_user, 'auth.users', 'TRIGGER')
  union all select 'storage.buckets: insert', null, has_table_privilege(current_user, 'storage.buckets', 'INSERT')
  union all select 'storage.buckets: update limits', null,
         has_column_privilege(current_user, 'storage.buckets', 'file_size_limit', 'UPDATE')
         and has_column_privilege(current_user, 'storage.buckets', 'allowed_mime_types', 'UPDATE')
         and has_column_privilege(current_user, 'storage.buckets', 'id', 'SELECT')
  union all select 'role bypasses RLS', null, (select rolbypassrls from pg_roles where rolname = current_user)
) x
order by 1;