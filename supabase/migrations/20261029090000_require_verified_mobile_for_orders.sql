-- =============================================================================
-- 15. Orders require a mobile number confirmed by SMS (server-side rule).
--
-- The website already sends customers whose number is not verified to the SMS
-- verification step before checkout, but a browser could call public.create_order()
-- directly. create_order() refuses incomplete profiles through
-- public.profile_is_complete(); this adds "the mobile number is verified"
-- (profiles.phone_verified_at, which only public.phone_otp_verify can set) to that rule.
--
-- * Same function name, arguments, return type and permissions as before
--   (CREATE OR REPLACE keeps the existing grants: service role only).
-- * NULL name/phone values are treated as empty.
-- * Effect: customers without a verified number get PROFILE_INCOMPLETE from
--   create_order() until they verify. Apply this ONLY after SMS sending (OneAPI)
--   works on the live site; otherwise nobody can place an order.
-- * Safe to re-run. Changes no rows and no tables.
-- =============================================================================

create or replace function public.profile_is_complete(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user::text
      and coalesce(btrim(first_name), '') <> ''
      and coalesce(btrim(last_name), '') <> ''
      and coalesce(btrim(phone), '') <> ''
      and phone_verified_at is not null
  )
$$;
revoke all on function public.profile_is_complete(uuid) from public, anon, authenticated;
grant execute on function public.profile_is_complete(uuid) to service_role;
