-- =============================================================================
-- POST-MIGRATION CHECKS (READ-ONLY). Run in the Supabase SQL editor AFTER the
-- migrations. Every row should show ok = true. Nothing is changed.
-- =============================================================================

-- 1. Row-level security is on for every table that holds customer or store data.
select c.relname as table_name, c.relrowsecurity as ok
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('profiles','yearth_profiles','yearth_addresses','yearth_account_preferences','customer_carts',
                    'orders','order_items','order_payments','products','product_variants','promo_codes',
                    'store_settings','support_messages','user_roles','disposable_email_domains','allowed_email_domains')
order by 1;

-- 2. Browser roles cannot write sensitive tables directly (expect ok = true).
select format('%s %s %s', r.role, p.priv, t.tbl) as check_name,
       not has_table_privilege(r.role, 'public.' || t.tbl, p.priv) as ok
from (values ('anon'), ('authenticated')) r(role)
cross join (values ('INSERT'), ('DELETE')) p(priv)
cross join (values ('orders'), ('order_items'), ('order_payments'), ('user_roles'), ('profiles')) t(tbl)
order by 1;

-- 3. Customers cannot read internal cost figures or admin notes (expect ok = true).
select 'authenticated cannot read orders.cost_total' as check_name,
       not has_column_privilege('authenticated', 'public.orders', 'cost_total', 'SELECT') as ok
union all select 'authenticated cannot read orders.admin_note',
       not has_column_privilege('authenticated', 'public.orders', 'admin_note', 'SELECT')
union all select 'anon cannot read products.cost_price',
       not has_column_privilege('anon', 'public.products', 'cost_price', 'SELECT')
union all select 'authenticated cannot read order_items.unit_cost',
       not has_column_privilege('authenticated', 'public.order_items', 'unit_cost', 'SELECT')
union all select 'anon cannot read promo_codes',
       not has_table_privilege('anon', 'public.promo_codes', 'SELECT');

-- 4. Server-only functions are not callable from the browser (expect ok = true).
select p.proname as function_name,
       not has_function_privilege('anon', p.oid, 'EXECUTE')
       and not has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('record_payment_order','mark_order_paid','mark_payment_failed','expire_unpaid_orders',
                    'hook_before_user_created','email_domain_is_disposable','profile_is_complete')
order by 1;

-- 5. The Auth hook is callable by the Auth service (expect ok = true).
select 'supabase_auth_admin can execute the hook' as check_name,
       has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'EXECUTE') as ok;

-- 6. Customer functions are callable when signed in (expect ok = true).
select p.proname as function_name, has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_order','cancel_order','save_my_profile','ensure_my_profile','set_default_address',
                    'check_promo_code','check_signup_email')
order by 1;

-- 7. Triggers created by the migrations (expect 4 rows).
select c.relname as table_name, t.tgname as trigger_name
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where t.tgname in ('on_auth_user_created_profile','on_auth_user_email_changed',
                   'orders_guard_before_update','orders_restock_after_cancel')
order by 1, 2;

-- 8. No email-based admin trigger exists (expect zero rows).
select tgname from pg_trigger where tgname = 'on_auth_user_admin';

-- 9. Every Auth user has a profile (expect missing_profiles = 0).
select count(*) as missing_profiles
from auth.users u left join public.profiles p on p.id = u.id::text where p.id is null;

-- 10. Profiles that will be asked to complete details on next sign-in.
select count(*) filter (where first_name = '' or last_name = '' or phone = '') as incomplete_profiles,
       count(*) as all_profiles
from public.profiles;

-- 11. Disposable-domain list loaded (expect several thousand) and sample checks.
select (select count(*) from public.disposable_email_domains) as blocked_domains,
       public.check_signup_email('test@mailinator.com') as mailinator_expect_disposable,
       public.check_signup_email('test@gmail.com') as gmail_expect_ok;

-- 12. Admin roles are unchanged by the migrations (compare with your earlier count: 2).
select role, count(*) from public.user_roles group by role;

-- 13. Keys, id defaults and the order-number sequence the migrations rely on
--     (expect ok = true; the last three come from ...091200).
select 'profiles: unique key on id' as check_name,
       exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
               where i.indrelid = 'public.profiles'::regclass and i.indisunique and i.indnatts = 1
                 and i.indpred is null and a.attname = 'id') as ok
union all select 'order number sequence exists', to_regclass('public.order_number_seq') is not null
union all select 'products.id has a default',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products'
                 and column_name = 'id' and column_default is not null)
union all select 'product_variants.id has a default',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'product_variants'
                 and column_name = 'id' and column_default is not null)
union all select 'product_variants: unique key on (product_id, colour, size)',
       exists (select 1 from pg_index i where i.indrelid = 'public.product_variants'::regclass
                 and i.indisunique and i.indpred is null and i.indexprs is null and i.indnkeyatts = 3
                 and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                       where a.attrelid = i.indrelid and a.attnum = any (i.indkey::smallint[]))
                     = array['colour', 'product_id', 'size']);
