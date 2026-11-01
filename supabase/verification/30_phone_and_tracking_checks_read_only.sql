-- =============================================================================
-- READ-ONLY checks after applying
--   20261028090600_phone_verification.sql
--   20261028090700_shipment_tracking.sql
-- Changes nothing. Every "ok" should be true.
-- =============================================================================

select 'profiles.phone_verified_at exists' as check_name,
       exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone_verified_at') as ok
union all
select 'trigger clears verification when the number changes',
       exists (select 1 from pg_trigger where tgname = 'profiles_phone_verification_reset'
               and tgrelid = 'public.profiles'::regclass)
union all
select 'challenge table has row-level security on',
       (select relrowsecurity from pg_class where oid = 'public.phone_verification_challenges'::regclass)
union all
select 'browsers cannot read challenges',
       not has_table_privilege('anon', 'public.phone_verification_challenges', 'select')
       and not has_table_privilege('authenticated', 'public.phone_verification_challenges', 'select')
union all
select 'browsers cannot call the verification functions',
       not has_function_privilege('anon', 'public.phone_otp_verify(uuid, text)', 'execute')
       and not has_function_privilege('authenticated', 'public.phone_otp_verify(uuid, text)', 'execute')
       and not has_function_privilege('authenticated', 'public.phone_otp_begin(uuid, uuid, text, text, text)', 'execute')
       and not has_function_privilege('authenticated', 'public.phone_otp_mark_sent(uuid, boolean)', 'execute')
union all
select 'server (service role) can call the verification functions',
       has_function_privilege('service_role', 'public.phone_otp_verify(uuid, text)', 'execute')
       and has_function_privilege('service_role', 'public.phone_otp_begin(uuid, uuid, text, text, text)', 'execute')
union all
select 'customers cannot update profiles directly (unchanged)',
       not has_table_privilege('authenticated', 'public.profiles', 'update')
union all
select 'shipment cache has row-level security on',
       (select relrowsecurity from pg_class where oid = 'public.order_shipments'::regclass)
union all
select 'browsers cannot read the shipment cache',
       not has_table_privilege('anon', 'public.order_shipments', 'select')
       and not has_table_privilege('authenticated', 'public.order_shipments', 'select')
union all
select 'order guard trigger still present',
       exists (select 1 from pg_trigger where tgname = 'orders_guard_before_update'
               and tgrelid = 'public.orders'::regclass);

-- Information only: how many customers have verified numbers so far.
select count(*) filter (where phone_verified_at is not null) as verified_numbers,
       count(*) filter (where phone <> '') as profiles_with_phone
from public.profiles;
